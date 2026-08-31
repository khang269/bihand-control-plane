"""
Self-contained agent flow for the Trading Studio Cloud Run job.

This package MUST NOT import `fastapp`. It runs in a zero-privilege container
holding no server credential: every LLM call and the final result go back to the
Bihand API authenticated by a per-task token.
"""
