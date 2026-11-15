# QA reports

Сюди агенти **Тестувальник** і **Виправляч** пишуть результати циклу QA.

- `qa-report.json` — звіт Тестувальника (схема в `qa-tester.md`).
- `fix-report.md` — короткий підсумок Виправляча після круга.
- `ui/` — скріншоти та `ui-report.json` від `node scripts/qa-ui.mjs`.

```json
{
  "generatedAt": "2026-11-15T12:00:00Z",
  "project": "D:\\plugin hub",
  "summary": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
  "bugs": [
    {
      "id": "QA-001",
      "severity": "high",
      "area": "Agents / drawer",
      "title": "Короткий опис",
      "steps": "1. Відкрити ...",
      "expected": "Очікуваний результат",
      "actual": "Фактичний результат",
      "fix": "Пропозиція",
      "status": "open|fixed|blocked",
      "fixSummary": "Що зроблено",
      "files": ["src/components/Agents.tsx"]
    }
  ],
  "add": [],
  "remove": [],
  "improve": []
}
```

`Scripts/qa-ui.mjs` перевіряє браузерний режим (`npm run dev`, mock API): вкладки, палітру, налаштування, агентів, теми. Він не замінює перевірку Tauri-бекенду — для неї агенти запускають `npm test`, `cargo test`, `npm run build`.
