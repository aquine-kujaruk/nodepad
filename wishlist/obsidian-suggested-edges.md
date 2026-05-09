# Obsidian Plugin: LLM-Suggested Edges

## Idea

Obsidian plugin que usa LLM (no embeddings) para sugerir conexiones entre notas. El usuario confirma, el plugin escribe el link. No modifica nada sin intervención humana.

## Filosofía

- LLM nomina candidatos → usuario decide → plugin ejecuta
- Enriquecimiento previo (tipo, tags, contexto LLM) mejora calidad de sugerencias
- Embeddings opcionales como filtro de retrieval, no como decisor final
- Inspirado en nodepad: LLM > embeddings para relaciones causales/contradictorias

## Por qué no obsidian-wiki (Ar9av)

`obsidian-wiki` delega el mantenimiento del vault al agente. Este approach mantiene al usuario como dueño del conocimiento — el LLM es staff, no curator.

## Pipeline

```
Notas en scope (temporal / grafo cercano)
  → LLM enriquece metadata: tipo, tags, contexto relacional   ← nodepad ya hace esto
  → Embed texto enriquecido                                   ← retrieval de calidad (opcional)
  → Retrieval selecciona ~30 candidatos del vault
  → LLM analiza candidatos → devuelve pares + confidence + justificación
  → Plugin muestra sugerencias en panel (EXTRACTED / INFERRED / AMBIGUOUS)
  → Usuario confirma → plugin escribe [[wikilink]]
```

## Scope de retrieval (sin embeddings)

- Notas tocadas esta semana
- Notas a 2 hops del nodo activo en el grafo
- Notas del mismo tag/carpeta

## Confidence scoring (robado de obsidian-wiki)

| Label | Score | Significado |
|-------|-------|-------------|
| EXTRACTED | ≥ 6 | Match explícito — nombre, alias, concepto directo |
| INFERRED | 3–5 | Relación semántica — mismo dominio, contradicción, implicación |
| AMBIGUOUS | 1–2 | Solo mostrar si el usuario lo pide |

Mostrar por defecto solo EXTRACTED + INFERRED.

## VS alternativas

| | Esta idea | obsidian-wiki | nodepad ghost notes |
|-|-----------|---------------|---------------------|
| Modifica notas sin permiso | No | Sí | No (efímero) |
| Escala a vault grande | Sí (scope limitado) | Sí (manifest) | No |
| Control del usuario | Total | Delegado al LLM | Parcial |
| Embeddings requeridos | No | Opcionales | No |
| Complejidad | Baja | Alta | Baja |

## Decisiones pendientes

- [ ] ¿Embeds opcionales o scope manual suficiente?
- [ ] ¿Panel sidebar o modal al abrir nota?
- [ ] ¿Gemini API o soportar múltiples providers (à la nodepad)?
- [ ] ¿Escribir links en frontmatter (`suggested-links:`) o en `## Related` section?
- [ ] ¿Scope configurable por el usuario o automático?

## Referencias

- Repo upstream nodepad: [mskayyali/nodepad](https://github.com/mskayyali/nodepad)
- Alternativa revisada: [Ar9av/obsidian-wiki](https://github.com/Ar9av/obsidian-wiki)
