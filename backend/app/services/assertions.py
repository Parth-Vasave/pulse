"""Pluggable response assertions.

An assertion is a dict `{"type": ..., ...params}`. New types are added by
registering an evaluator with `@register("type")`; the API schema validates the
parameters, the worker only needs this registry.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

MAX_BODY_BYTES = 1024 * 1024


@dataclass(frozen=True)
class ResponseView:
    status_code: int
    headers: dict[str, str]
    body: str


@dataclass(frozen=True)
class AssertionResult:
    passed: bool
    message: str = ""


Evaluator = Callable[[dict[str, Any], ResponseView], AssertionResult]
_REGISTRY: dict[str, Evaluator] = {}


def register(name: str) -> Callable[[Evaluator], Evaluator]:
    def deco(fn: Evaluator) -> Evaluator:
        _REGISTRY[name] = fn
        return fn

    return deco


def registered_types() -> set[str]:
    return set(_REGISTRY)


_MISSING = object()


def _lookup(data: Any, path: str) -> Any:
    """Resolve a dotted path ('a.b.0.c'); list indices are numeric segments."""
    current = data
    for segment in path.split("."):
        if isinstance(current, dict) and segment in current:
            current = current[segment]
        elif isinstance(current, list) and segment.isdigit() and int(segment) < len(current):
            current = current[int(segment)]
        else:
            return _MISSING
    return current


@register("body_contains")
def _body_contains(params: dict[str, Any], resp: ResponseView) -> AssertionResult:
    needle = str(params["value"])
    ok = needle in resp.body
    return AssertionResult(ok, "" if ok else f"Response body does not contain {needle!r}")


@register("body_not_contains")
def _body_not_contains(params: dict[str, Any], resp: ResponseView) -> AssertionResult:
    needle = str(params["value"])
    ok = needle not in resp.body
    return AssertionResult(ok, "" if ok else f"Response body unexpectedly contains {needle!r}")


@register("json_field")
def _json_field(params: dict[str, Any], resp: ResponseView) -> AssertionResult:
    path, op = params["path"], params.get("operator", "eq")
    try:
        data = json.loads(resp.body)
    except ValueError:
        return AssertionResult(False, "Response body is not valid JSON")
    actual = _lookup(data, path)
    if op == "exists":
        ok = actual is not _MISSING
        return AssertionResult(ok, "" if ok else f"JSON field '{path}' is missing")
    if actual is _MISSING:
        return AssertionResult(False, f"JSON field '{path}' is missing")
    expected = params.get("value")
    if op == "eq":
        ok = actual == expected
    elif op == "ne":
        ok = actual != expected
    elif op == "contains":
        ok = isinstance(actual, str | list) and expected in actual
    else:
        return AssertionResult(False, f"Unknown operator '{op}'")
    return AssertionResult(ok, "" if ok else f"JSON field '{path}' is {actual!r}, expected {op} {expected!r}")


def evaluate_all(assertions: list[dict[str, Any]], resp: ResponseView) -> AssertionResult:
    """First failing assertion wins. Unknown types fail closed so typos are visible."""
    for assertion in assertions:
        evaluator = _REGISTRY.get(assertion.get("type", ""))
        if evaluator is None:
            return AssertionResult(False, f"Unknown assertion type {assertion.get('type')!r}")
        result = evaluator(assertion, resp)
        if not result.passed:
            return result
    return AssertionResult(True)
