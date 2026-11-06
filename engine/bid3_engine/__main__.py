"""python -m bid3_engine  — run the engine with uvicorn."""

import logging
import os

import uvicorn

from .api import create_app


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(
        create_app(),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
        # One process only: the engine is the single authority for every auction.
        workers=1,
    )


if __name__ == "__main__":
    main()
