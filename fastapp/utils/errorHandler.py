"""
Error handling utilities for FastAPI.
"""

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse


class CustomError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class BadRequestError(CustomError):
    def __init__(self, message="Bad Request"):
        super().__init__(message, 400)


class UnauthorizedError(CustomError):
    def __init__(self, message="Unauthorized"):
        super().__init__(message, 401)


class NotFoundError(CustomError):
    def __init__(self, message="Not Found"):
        super().__init__(message, 404)


class InternalServerError(CustomError):
    def __init__(self, message="Internal Server Error"):
        super().__init__(message, 500)


def register_error_handlers(app):
    """Register custom exception handlers with the FastAPI app."""

    @app.exception_handler(CustomError)
    async def handle_custom_error(request: Request, exc: CustomError):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.__class__.__name__,
                "message": exc.message,
            },
        )

    @app.exception_handler(Exception)
    async def handle_generic_exception(request: Request, exc: Exception):
        # Don't catch HTTPExceptions — let FastAPI handle them
        if isinstance(exc, HTTPException):
            raise exc
        
        import traceback, sys
        sys.stderr.write("Unexpected exception traceback:\n" + traceback.format_exc() + "\n")
        sys.stderr.flush()
        print(f"Unexpected exception: {exc}")
        return JSONResponse(
            status_code=500,
            content={
                "error": "InternalServerError",
                "message": "An unexpected error occurred.",
            },
        )