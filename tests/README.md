# Tests

Prioritize tests that protect the demo path:

- telemetry CSV validation
- frame encoding checks
- safe and dangerous scenario loading
- reachability calculation for detour and return-to-start reserve
- cached Cerebras replay behavior
- agent output schema validation
- commander fallback behavior
- end-to-end run with sample data

Run from the repository root:

```bash
pytest
```
