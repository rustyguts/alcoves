# Alcoves Media Server

### Notes

https://htmx.org/docs/#installing
https://blog.pecar.me/uv-with-django
https://github.com/serengil/deepface
https://docs.djangoproject.com/en/5.2/ref/settings
https://learndjango.com/tutorials/django-login-and-logout-tutorial

docker compose exec alcoves uv run manage.py createsuperuser

### Database Migrations

docker compose exec alcoves uv run manage.py makemigrations
docker compose exec alcoves uv run manage.py migrate

### Open Telemetry

uv add opentelemetry-distro opentelemetry-exporter-otlp

This is dumb because they get uninstalled every time you run uv sync?

uv run opentelemetry-bootstrap -a requirements | uv pip install --requirement -

#### OpenTelemetry Instrumentation

To install the required OpenTelemetry instrumentation packages, use the following `uv add` commands:

```bash
uv add opentelemetry-instrumentation-asgi
uv add opentelemetry-instrumentation-asyncio
uv add opentelemetry-instrumentation-dbapi
uv add opentelemetry-instrumentation-django
uv add opentelemetry-instrumentation-grpc
uv add opentelemetry-instrumentation-logging
uv add opentelemetry-instrumentation-requests
uv add opentelemetry-instrumentation-sqlite3
uv add opentelemetry-instrumentation-threading
uv add opentelemetry-instrumentation-urllib
uv add opentelemetry-instrumentation-urllib3
uv add opentelemetry-instrumentation-wsgi
uv add opentelemetry-util-http
```

go get go.opentelemetry.io/otel/exporters/otlp/otlptrace
go get go.opentelemetry.io/otel/exporters/otlp/otlpmetric
