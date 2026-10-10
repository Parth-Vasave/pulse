import pytest

from app.services.assertions import ResponseView, evaluate_all, registered_types


def resp(body, status=200):
    return ResponseView(status, {}, body)


def test_body_contains():
    assert evaluate_all(
        [{"type": "body_contains", "value": '"database": "connected"'}], resp('{"database": "connected"}')
    ).passed
    assert not evaluate_all([{"type": "body_contains", "value": "x"}], resp("abc")).passed


def test_json_field_eq():
    a = [{"type": "json_field", "path": "status", "operator": "eq", "value": "healthy"}]
    assert evaluate_all(a, resp('{"status": "healthy"}')).passed
    r = evaluate_all(a, resp('{"status": "degraded"}'))
    assert not r.passed and "degraded" in r.message


def test_json_nested_and_list_paths():
    a = [{"type": "json_field", "path": "checks.0.ok", "operator": "eq", "value": True}]
    assert evaluate_all(a, resp('{"checks": [{"ok": true}]}')).passed


@pytest.mark.parametrize(
    ("value", "body"),
    [("200", '{"code": 200}'), ("1.5", '{"code": 1.5}'), ("true", '{"code": true}'), ("null", '{"code": null}')],
)
def test_json_eq_matches_text_from_the_form_against_typed_fields(value, body):
    eq = [{"type": "json_field", "path": "code", "operator": "eq", "value": value}]
    ne = [{"type": "json_field", "path": "code", "operator": "ne", "value": value}]
    assert evaluate_all(eq, resp(body)).passed
    assert not evaluate_all(ne, resp(body)).passed


def test_json_eq_keeps_types_apart():
    def eq(value, body):
        return evaluate_all([{"type": "json_field", "path": "v", "operator": "eq", "value": value}], resp(body)).passed

    assert not eq("201", '{"v": 200}')
    assert not eq(1, '{"v": true}')  # True == 1 in Python, not in JSON
    assert not eq("true", '{"v": 1}')
    assert not eq(200, '{"v": "200"}')  # a string field compares as a string
    assert not eq("not json", '{"v": 5}')


def test_json_contains_on_lists_and_strings():
    def contains(value, body):
        a = [{"type": "json_field", "path": "v", "operator": "contains", "value": value}]
        return evaluate_all(a, resp(body)).passed

    assert contains("2", '{"v": [1, 2, 3]}')
    assert not contains("4", '{"v": [1, 2, 3]}')
    assert contains("ok", '{"v": "all ok"}')
    assert contains(5, '{"v": "v5"}')  # used to raise TypeError


def test_json_missing_field_and_invalid_json():
    a = [{"type": "json_field", "path": "a.b", "operator": "exists"}]
    assert not evaluate_all(a, resp('{"a": {}}')).passed
    assert "not valid JSON" in evaluate_all(a, resp("<html>")).message


def test_unknown_type_fails_closed():
    assert not evaluate_all([{"type": "nope"}], resp("")).passed


def test_empty_assertions_pass_and_first_failure_wins():
    assert evaluate_all([], resp("")).passed
    r = evaluate_all([{"type": "body_contains", "value": "a"}, {"type": "body_contains", "value": "zzz"}], resp("a"))
    assert "zzz" in r.message


def test_registry_extensible():
    assert {"body_contains", "body_not_contains", "json_field"} <= registered_types()
