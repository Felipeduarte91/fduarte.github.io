# Deteccion de plagio

Correccion del script original. Dos modulos:

- `similarity.py` — compara un texto contra una lista de referencias y devuelve el
  porcentaje de similitud de **cada una**, mas la mas parecida.
- `ml_model.py` — entrena un `RandomForestClassifier` sobre caracteristicas del
  **par** (texto, posible fuente).

## Uso

```bash
python3 similarity.py

python3 ml_model.py --train plagiarism_dataset.csv
python3 ml_model.py --text "texto sospechoso" --source "texto fuente"
```

El CSV de entrenamiento necesita las columnas `text`, `source_text` y `label`
(1 = plagiado, 0 = original). `plagiarism_dataset.csv` es un ejemplo sintetico.

## Errores corregidos

### `similarity.py`
1. `preprocess_text` decia "remove extra whitespace" pero solo hacia `.strip()`:
   los espacios internos multiples no se colapsaban.
2. `string.punctuation` es solo ASCII, asi que `¿ ¡ — “ ”` sobrevivian. Ahora se
   normaliza a NFKC y se limpia con una regex unicode.
3. `difflib.Differ` es una herramienta de *formateo* y es O(n^2); ademas contar
   lineas que empiezan con `'  '` divide entre `max(len(a), len(b))`, lo que da
   un puntaje asimetrico. Se usa `SequenceMatcher.ratio()`, simetrico y directo.
4. `max()` sobre una lista de referencias vacia lanzaba `ValueError`.
5. La consigna pedia el porcentaje contra **cada** texto, pero la funcion solo
   devolvia el maximo. Ahora se devuelve un `PlagiarismReport` con todos los
   puntajes ordenados (sigue siendo desempaquetable como antes).
6. Se añadio `containment_score` para el caso de un fragmento copiado dentro de
   un documento mucho mas largo, donde `ratio()` se diluye por la longitud.

### `ml_model.py`
7. **Error de fondo:** las caracteristicas eran `[n_palabras, n_unicas,
   largo_medio, n_frases]`, todas del texto *aislado*. El plagio es una relacion
   entre un texto y su fuente: con el mismo texto y dos fuentes distintas (una
   copiada y otra no) esas cuatro cifras son identicas, asi que el modelo no
   puede separarlas ni en principio. Se reemplazaron por caracteristicas del par.
8. `preprocess_text_ml` quitaba la puntuacion **antes** de `sent_tokenize`, con
   lo que `num_sentences` siempre valia 1. Ahora las frases se cuentan sobre el
   texto crudo.
9. `nltk.download('punkt')` en tiempo de importacion: requiere red en cada
   ejecucion y desde NLTK 3.8.2 el recurso se llama `punkt_tab`, asi que
   `word_tokenize` fallaba con `LookupError`. Se elimino la dependencia.
10. Tres bloques `if __name__ == "__main__":` en el mismo archivo se ejecutaban
    en cadena: el entrenamiento corria siempre y el `joblib.load` posterior
    reventaba si el `fit` habia fallado. Ahora hay un unico `main()` con CLI.
11. `pd.read_csv` sin comprobaciones: fallaba con `FileNotFoundError` crudo o con
    `KeyError` si faltaban columnas. Se valida ruta, columnas, nulos y que haya
    ambas clases.
12. `train_test_split` sin `stratify`: un split desafortunado podia dejar el test
    con una sola clase.
13. `classification_report` sin `zero_division=0` emitia warnings con clases
    ausentes; `RandomForestClassifier` no usaba `class_weight="balanced"`.
14. `prediction[0] == 1` asumia el orden de clases; ahora la probabilidad se lee
    via `model.classes_`.
15. Se quitaron imports sin usar (`re`, `matplotlib`, `seaborn`, `warnings`,
    `os`, `sys`, `sklearn` a secas) e imports locales dentro de funciones.

## Nota

El accuracy de 1.00 sobre `plagiarism_dataset.csv` refleja que el dataset es
sintetico y trivialmente separable, no la calidad real del modelo. Con datos
reales hay que esperar cifras mas bajas.
