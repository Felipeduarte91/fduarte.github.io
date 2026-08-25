"""Deteccion de plagio por similitud lexica contra una lista de textos de referencia.

Devuelve el porcentaje de similitud del texto de entrada contra CADA texto de
referencia, ademas del mas similar.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass, field

# \w cubre letras acentuadas y digitos en Python 3 (modo unicode por defecto).
_NOT_WORD = re.compile(r"[^\w\s]", re.UNICODE)
_SPACES = re.compile(r"\s+", re.UNICODE)


def preprocess_text(text: str) -> str:
    """Normaliza el texto: minusculas, sin puntuacion y con espacios colapsados."""
    if text is None:
        return ""
    # NFKC unifica variantes unicode (comillas tipograficas, ligaduras, etc.).
    text = unicodedata.normalize("NFKC", str(text)).casefold()
    text = _NOT_WORD.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def calculate_similarity(text1: str, text2: str) -> float:
    """Porcentaje de similitud [0, 100] entre dos textos, a nivel de palabra.

    Usa SequenceMatcher.ratio(), que es simetrico y considera todos los bloques
    coincidentes: 2 * coincidencias / (len(a) + len(b)).
    """
    words1 = preprocess_text(text1).split()
    words2 = preprocess_text(text2).split()

    if not words1 and not words2:
        return 100.0
    if not words1 or not words2:
        return 0.0

    matcher = difflib.SequenceMatcher(None, words1, words2, autojunk=False)
    return matcher.ratio() * 100.0


def containment_score(input_text: str, reference_text: str) -> float:
    """Porcentaje del texto de entrada contenido en la referencia (asimetrico).

    Util cuando se copia un fragmento dentro de un documento mucho mas largo,
    caso en el que ratio() se diluye por la diferencia de longitud.
    """
    words1 = preprocess_text(input_text).split()
    words2 = preprocess_text(reference_text).split()
    if not words1 or not words2:
        return 0.0

    matcher = difflib.SequenceMatcher(None, words1, words2, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return (matched / len(words1)) * 100.0


@dataclass
class PlagiarismReport:
    """Resultado completo: puntaje por referencia y el mejor candidato."""

    scores: list[tuple[str, float]] = field(default_factory=list)
    most_similar_text: str | None = None
    max_similarity: float = 0.0
    is_plagiarism: bool = False

    def __iter__(self):
        # Compatibilidad con el desempaquetado original:
        #   most_similar_text, similarity = identify_plagiarism(...)
        return iter((self.most_similar_text, self.max_similarity))


def identify_plagiarism(
    input_text: str,
    reference_texts,
    threshold: float = 70.0,
    use_containment: bool = False,
) -> PlagiarismReport:
    """Compara input_text contra cada referencia y ordena por similitud."""
    scorer = containment_score if use_containment else calculate_similarity

    scores = [(ref, scorer(input_text, ref)) for ref in reference_texts]
    scores.sort(key=lambda item: item[1], reverse=True)

    if not scores:
        # Sin referencias no hay nada que comparar: no reventar con ValueError.
        return PlagiarismReport(scores=[])

    best_text, best_score = scores[0]
    return PlagiarismReport(
        scores=scores,
        most_similar_text=best_text,
        max_similarity=best_score,
        is_plagiarism=best_score >= threshold,
    )


def main() -> None:
    input_text = "This is a sample text to check for plagiarism."
    reference_texts = [
        "Is a sample text to check for cat.",
        "Is a sample text to check for dog.",
        "Completely different content that should not match.",
    ]

    report = identify_plagiarism(input_text, reference_texts, threshold=70.0)

    print(f"Texto analizado: {input_text!r}\n")
    print("Similitud contra cada referencia:")
    for ref, score in report.scores:
        print(f"  {score:6.2f}%  {ref}")

    print(f"\nTexto mas similar: {report.most_similar_text}")
    print(f"Porcentaje de similitud: {report.max_similarity:.2f}%")
    print(f"Veredicto (umbral 70%): {'PLAGIO' if report.is_plagiarism else 'ORIGINAL'}")


if __name__ == "__main__":
    main()
