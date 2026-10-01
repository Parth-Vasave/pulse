import pytest

from app.services.state_machine import Action, HealthState, Status, next_state


def run(results, failure_threshold=3, recovery_threshold=2, state=None):
    state = state or HealthState()
    actions = []
    for ok in results:
        t = next_state(state, ok, failure_threshold, recovery_threshold)
        state = t.state
        actions.append(t.action)
    return state, actions


def test_incident_opens_exactly_at_failure_threshold():
    state, actions = run([False, False, False])
    assert actions == [Action.NONE, Action.NONE, Action.OPEN_INCIDENT]
    assert state.status is Status.DOWN


def test_no_duplicate_incident_during_ongoing_outage():
    _, actions = run([False] * 6)
    assert actions.count(Action.OPEN_INCIDENT) == 1


def test_success_resets_failure_streak():
    state, actions = run([False, False, True, False, False])
    assert Action.OPEN_INCIDENT not in actions
    assert state.consecutive_failures == 2


def test_resolves_only_after_recovery_threshold():
    _, actions = run([False] * 3 + [True, True])
    assert actions[3] is Action.NONE
    assert actions[4] is Action.RESOLVE_INCIDENT


def test_failure_during_recovery_resets_success_streak():
    state, actions = run([False] * 3 + [True, False, True])
    assert Action.RESOLVE_INCIDENT not in actions
    assert state.status is Status.DOWN
    assert state.consecutive_successes == 1


def test_new_incident_after_recovery():
    _, actions = run([False] * 3 + [True, True] + [False] * 3)
    assert actions.count(Action.OPEN_INCIDENT) == 2
    assert actions.count(Action.RESOLVE_INCIDENT) == 1


def test_first_success_marks_up():
    state, _ = run([True])
    assert state.status is Status.UP


@pytest.mark.parametrize("threshold", [1, 2, 5])
def test_threshold_boundaries(threshold):
    _, actions = run([False] * threshold, failure_threshold=threshold)
    assert actions[-1] is Action.OPEN_INCIDENT
    assert all(a is Action.NONE for a in actions[:-1])


def test_recovery_threshold_one_resolves_immediately():
    _, actions = run([False] * 3 + [True], recovery_threshold=1)
    assert actions[-1] is Action.RESOLVE_INCIDENT
