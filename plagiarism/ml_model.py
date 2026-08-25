"""Modelo de aprendizaje automatico para detectar plagio.

Diferencia clave respecto a la version original: el plagio es una RELACION entre
un texto y su posible fuente, no una propiedad aislada del texto. Por eso las
caracteristicas se calculan sobre el PAR (texto, fuente) y no sobre el texto solo.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

from similarity import calculate_similarity, containment_score, preprocess_text

MODEL_PATH = Path("plagiarism_model.pkl")

FEATURE_NAMES = [
    "similarity_ratio",
    "containment",
    "jaccard_tokens",
    "jaccard_trigrams",
    "length_ratio",
    "longest_match_ratio",
    "unique_ratio_input",
    "avg_word_length_input",
    "sentences_input",
]

_SENTENCE_END = re.compile(r"[.!?…¡¿]+(?:\s|$)")


def count_sentences(text: str) -> int:
    """Cuenta frases sobre el texto CRUDO.

    Debe llamarse antes de quitar la puntuacion: si se normaliza primero, no
    quedan delimitadores y el conteo siempre da 1.
    """
    if not text or not text.strip():
        return 0
    return max(1, len(_SENTENCE_END.findall(unicodedata.normalize("NFKC", text))))


def word_ngrams(tokens: list[str], n: int) -> set[tuple[str, ...]]:
    if len(tokens) < n:
        return {tuple(tokens)} if tokens else set()
    return {tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)}


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def extract_pair_features(text: str, source: str) -> list[float]:
    """Caracteristicas del par (texto, posible fuente)."""
    tokens = preprocess_text(text).split()
    source_tokens = preprocess_text(source).split()

    if not tokens:
        return [0.0] * len(FEATURE_NAMES)

    longest_match = 0
    if source_tokens:
        import difflib

        matcher = difflib.SequenceMatcher(None, tokens, source_tokens, autojunk=False)
        longest_match = matcher.find_longest_match(
            0, len(tokens), 0, len(source_tokens)
        ).size

    return [
        calculate_similarity(text, source) / 100.0,
        containment_score(text, source) / 100.0,
        _jaccard(set(tokens), set(source_tokens)),
        _jaccard(word_ngrams(tokens, 3), word_ngrams(source_tokens, 3)),
        min(len(tokens), len(source_tokens)) / max(len(tokens), len(source_tokens), 1),
        longest_match / len(tokens),
        len(set(tokens)) / len(tokens),
        float(np.mean([len(w) for w in tokens])),
        float(count_sentences(text)),
    ]


def build_feature_matrix(df: pd.DataFrame) -> np.ndarray:
    rows = [
        extract_pair_features(text, source)
        for text, source in zip(df["text"], df["source_text"])
    ]
    return np.asarray(rows, dtype=float)


def load_dataset(data_path: str | Path) -> pd.DataFrame:
    path = Path(data_path)
    if not path.is_file():
        raise FileNotFoundError(
            f"No se encontro el dataset en {path.resolve()}. "
            "Se esperan columnas: text, source_text, label."
        )

    df = pd.read_csv(path)
    required = {"text", "source_text", "label"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            f"Al dataset le faltan columnas: {sorted(missing)}. "
            f"Columnas encontradas: {list(df.columns)}"
        )

    df = df.dropna(subset=["text", "source_text", "label"]).copy()
    df["label"] = df["label"].astype(int)
    if df["label"].nunique() < 2:
        raise ValueError("El dataset necesita ejemplos de ambas clases (0 y 1).")
    return df


def train_plagiarism_model(
    data_path: str | Path,
    model_path: Path = MODEL_PATH,
    test_size: float = 0.2,
    random_state: int = 42,
) -> RandomForestClassifier:
    df = load_dataset(data_path)

    features = build_feature_matrix(df)
    labels = df["label"].to_numpy()

    X_train, X_test, y_train, y_test = train_test_split(
        features,
        labels,
        test_size=test_size,
        random_state=random_state,
        # stratify conserva la proporcion de clases; sin esto un split
        # desafortunado puede dejar el test con una sola clase.
        stratify=labels,
    )

    model = RandomForestClassifier(
        n_estimators=100,
        random_state=random_state,
        class_weight="balanced",
    )
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)

    print("Classification Report:")
    print(
        classification_report(
            y_test,
            y_pred,
            target_names=["original", "plagiado"],
            zero_division=0,
        )
    )
    print("Confusion Matrix (filas=real, columnas=predicho):")
    print(confusion_matrix(y_test, y_pred, labels=[0, 1]))

    print("\nImportancia de caracteristicas:")
    for name, importance in sorted(
        zip(FEATURE_NAMES, model.feature_importances_),
        key=lambda item: item[1],
        reverse=True,
    ):
        print(f"  {importance:6.3f}  {name}")

    joblib.dump({"model": model, "feature_names": FEATURE_NAMES}, model_path)
    print(f"\nModelo guardado en {model_path.resolve()}")
    return model


def predict(text: str, source: str, model_path: Path = MODEL_PATH) -> tuple[int, float]:
    if not model_path.is_file():
        raise FileNotFoundError(
            f"No existe {model_path}. Entrena primero con --train <dataset.csv>."
        )

    bundle = joblib.load(model_path)
    model = bundle["model"]

    features = np.asarray(extract_pair_features(text, source), dtype=float).reshape(1, -1)
    label = int(model.predict(features)[0])
    # predict_proba respeta el orden de model.classes_, no asumir [0, 1].
    proba = float(model.predict_proba(features)[0][list(model.classes_).index(1)])
    return label, proba


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deteccion de plagio con ML.")
    parser.add_argument("--train", metavar="CSV", help="entrena con el dataset dado")
    parser.add_argument("--text", help="texto sospechoso a evaluar")
    parser.add_argument("--source", help="texto fuente contra el que comparar")
    parser.add_argument("--model", default=str(MODEL_PATH), help="ruta del modelo")
    args = parser.parse_args(argv)

    model_path = Path(args.model)

    if not args.train and not args.text:
        parser.print_help()
        return 0

    try:
        if args.train:
            train_plagiarism_model(args.train, model_path=model_path)

        if args.text:
            if not args.source:
                parser.error("--text requiere --source (el plagio es una relacion).")
            label, proba = predict(args.text, args.source, model_path=model_path)
            veredicto = "PLAGIADO" if label == 1 else "ORIGINAL"
            print(f"\nPrediccion: {veredicto} (probabilidad de plagio: {proba:.2%})")
    except (FileNotFoundError, ValueError) as exc:
        # Errores de uso esperados (falta el dataset o el modelo, columnas mal):
        # un mensaje claro es mas util que un traceback.
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
