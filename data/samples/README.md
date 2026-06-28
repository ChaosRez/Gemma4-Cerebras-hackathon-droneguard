# Sample Data

Store demo scenarios here.

Recommended layout:

```text
data/samples/
|-- safe/
|   |-- frames/
|   |-- cache/
|   |-- scenario.json
|   |-- telemetry.csv
|   `-- mission.txt
`-- dangerous/
    |-- frames/
    |-- cache/
    |-- scenario.json
    |-- telemetry.csv
    `-- mission.txt
```

Do not commit sensitive flight logs or private location data. Synthetic telemetry is preferred for the hackathon demo.

The prototype uses `scenarios.json`, safe/dangerous telemetry CSVs, generated PNG keyframes, and replay seeds under `cache/seeds/`.

If frame images need to be regenerated:

```bash
python scripts/generate_sample_assets.py
```
