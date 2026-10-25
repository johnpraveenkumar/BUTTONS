# WealthWave Budget

Flask budget dashboard with HTML, CSS, JavaScript, and SQLite.

## Run locally

```bash
python -m pip install -r requirements.txt
python app.py
```

Open the local URL shown by Flask. The Statistics panel has a month picker and a Refresh button. Changing the month automatically reloads the dashboard; Refresh manually reloads the currently selected month.

## Note for hosting

SQLite files stored on ephemeral serverless filesystems may not persist reliably between deployments or instances. Use a persistent database for production financial records.
