"""python -m bid3_engine  — run the engine with uvicorn."""

import logging
import os
import re

import uvicorn

from .api import create_app


_TOKEN = re.compile(r"([?&]token=)[^\s&\"']+")


def _redact(value: object) -> object:
    return _TOKEN.sub(r"\1***", value) if isinstance(value, str) else value


class RedactTokens(logging.Filter):
    """Keep the bridge token out of the logs. The bridge sends it as /bridge?token=..., and uvicorn
    logs every WebSocket path with its query string ("WebSocket /bridge?token=... [accepted]")."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_redact(a) for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {k: _redact(v) for k, v in record.args.items()}
        return True


def main() -> None:
    # uvicorn's dictConfig replaces handlers but keeps logger filters, so these survive uvicorn.run().
    for name in ("uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).addFilter(RedactTokens())
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(
        create_app(),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8010")),
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
        # One process only: the engine is the single authority for every auction.
        workers=1,
    )


if __name__ == "__main__":
    main()
