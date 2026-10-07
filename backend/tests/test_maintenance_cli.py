"""
The two maintenance CLIs, as commands rather than as functions.

Both exist because the capability was already in the codebase with no way to reach
it: `ADMIN_EMAIL` was documented as the input to creating the first administrator
while `promote_admin.py` never read it, and `purge_expired_sessions` had no caller
at all. A command line is what turns a helper into something an operator can
actually schedule.
"""

import pytest

import json

from db import promote_admin, purge_consent, purge_positions, purge_sessions


class TestAdminEmailIsRead:
    """ADMIN_EMAIL is the documented input to --create-first, so it has to be read."""

    def test_it_is_read_from_the_environment(self, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAIL", "  Owner@Example.ID ")
        assert promote_admin._bootstrap_email() == "owner@example.id"

    def test_it_is_read_from_the_env_file(self, monkeypatch, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text("DATABASE_URL=postgres://x\nADMIN_EMAIL=a@b.id\n", encoding="utf-8")
        monkeypatch.delenv("ADMIN_EMAIL", raising=False)
        monkeypatch.setattr(promote_admin, "_ENV_FILE", env_file)
        assert promote_admin._bootstrap_email() == "a@b.id"

    def test_the_environment_wins_over_the_file(self, monkeypatch, tmp_path):
        """Exporting it for one invocation should not be overruled by the file."""
        env_file = tmp_path / ".env"
        env_file.write_text("ADMIN_EMAIL=from-file@b.id\n", encoding="utf-8")
        monkeypatch.setattr(promote_admin, "_ENV_FILE", env_file)
        monkeypatch.setenv("ADMIN_EMAIL", "from-env@b.id")
        assert promote_admin._bootstrap_email() == "from-env@b.id"

    @pytest.mark.parametrize("contents", ["ADMIN_EMAIL=\n", "ADMIN_EMAIL=   \n", ""])
    def test_an_unset_setting_reports_absence(self, monkeypatch, tmp_path, contents):
        env_file = tmp_path / ".env"
        env_file.write_text(contents, encoding="utf-8")
        monkeypatch.delenv("ADMIN_EMAIL", raising=False)
        monkeypatch.setattr(promote_admin, "_ENV_FILE", env_file)
        # None, not "": the caller has to be able to tell "not configured" from a
        # value that happens to be empty.
        assert promote_admin._bootstrap_email() is None


class TestCreateFirstTakesTheEmailFromAdminEmail:
    def test_a_bare_flag_uses_the_setting(self, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAIL", "owner@example.id")
        called = {}
        monkeypatch.setattr(
            promote_admin,
            "create_first",
            lambda email, name, phone: called.update(
                email=email, name=name, phone=phone
            )
            or 0,
        )
        assert promote_admin.main(["--create-first", "--name", "Pemilik", "--phone", "0812"]) == 0
        assert called["email"] == "owner@example.id"

    def test_an_explicit_email_still_wins(self, monkeypatch):
        monkeypatch.setenv("ADMIN_EMAIL", "owner@example.id")
        called = {}
        monkeypatch.setattr(
            promote_admin,
            "create_first",
            lambda email, name, phone: called.update(email=email) or 0,
        )
        promote_admin.main(
            ["--create-first", "other@example.id", "--name", "X", "--phone", "0812"]
        )
        assert called["email"] == "other@example.id"

    def test_a_bare_flag_without_the_setting_is_an_error(self, monkeypatch, capsys):
        monkeypatch.delenv("ADMIN_EMAIL", raising=False)
        monkeypatch.setattr(promote_admin, "_ENV_FILE", promote_admin.Path("/nonexistent"))
        monkeypatch.setattr(
            promote_admin, "create_first", lambda *a, **k: pytest.fail("must not create")
        )
        with pytest.raises(SystemExit):
            promote_admin.main(["--create-first", "--name", "X", "--phone", "0812"])
        assert "ADMIN_EMAIL" in capsys.readouterr().err

    def test_no_arguments_at_all_is_still_an_error(self, monkeypatch):
        """Bare --create-first and no --create-first have to be distinguishable.

        `nargs="?"` without `const` gives the bare flag the same value as omitting
        it, which would make the ADMIN_EMAIL path silently unreachable.
        """
        monkeypatch.delenv("ADMIN_EMAIL", raising=False)
        monkeypatch.setattr(
            promote_admin, "create_first", lambda *a, **k: pytest.fail("must not create")
        )
        with pytest.raises(SystemExit):
            promote_admin.main([])


class TestPurgeSessions:
    def test_a_dry_run_counts_and_deletes_nothing(self, monkeypatch, capsys):
        deleted = []
        monkeypatch.setattr(
            purge_sessions, "purge_expired_sessions", lambda: _record(deleted)
        )
        monkeypatch.setattr(purge_sessions, "_count_expired", lambda: _counted(7))
        assert purge_sessions.main(["--dry-run"]) == 0
        out = capsys.readouterr().out
        assert "7 expired" in out
        assert "Nothing was deleted" in out
        assert deleted == []

    def test_a_dry_run_reports_zero_without_inventing_a_number(self, monkeypatch, capsys):
        monkeypatch.setattr(purge_sessions, "_count_expired", lambda: _counted(0))
        assert purge_sessions.main(["--dry-run"]) == 0
        assert "0 expired" in capsys.readouterr().out

    def test_the_real_run_reports_what_it_removed(self, monkeypatch, capsys):
        monkeypatch.setattr(purge_sessions, "purge_expired_sessions", lambda: _record([], 4))
        assert purge_sessions.main([]) == 0
        assert "4 expired" in capsys.readouterr().out


def _counted(n):
    async def inner():
        return n

    return inner()


def _record(sink, result=0):
    async def inner():
        sink.append(result)
        return result

    return inner()

class TestPurgePositions:
    """Clearing positions whose ticker is not a listed IDX instrument.

    `PUT /v1/portfolio/positions` refuses unknown symbols now, so this is about
    the ones already stored — written before that check, or while `instruments`
    was still empty.
    """

    def _pool(self, listed, portfolios):
        class Pool:
            async def fetch(self, query, *args):
                if "FROM instruments" in query:
                    return [{"symbol": s} for s in listed]
                if "FROM portfolios" in query:
                    return [
                        {"id": pid, "lots_json": json.dumps(lots)}
                        for pid, lots in portfolios.items()
                    ]
                raise AssertionError(f"unexpected fetch: {query!r}")

            async def fetchrow(self, query, *args):
                if "FROM portfolios WHERE id" in query:
                    for pid, lots in portfolios.items():
                        if pid == args[0]:
                            return {"lots_json": json.dumps(lots)}
                raise AssertionError(f"unexpected fetchrow: {query!r}")

            async def execute(self, query, *args):
                written.append((args[0], args[1]))
                return "UPDATE 1"

        written: list[tuple[str, str]] = []
        return Pool(), written

    def test_a_dry_run_reports_and_changes_nothing(self, monkeypatch, capsys):
        pool, written = self._pool(["BBCA"], {"pf_1": {"BBCA": 100, "FAKE": 50}})
        monkeypatch.setattr(purge_positions, "get_pool", lambda: _ready(pool))

        assert purge_positions.main(["--dry-run"]) == 0
        out = capsys.readouterr().out
        assert "FAKE" in out
        assert "Nothing was deleted" in out
        assert written == []

    def test_a_clean_portfolio_says_so(self, monkeypatch, capsys):
        pool, _ = self._pool(["BBCA", "TLKM"], {"pf_1": {"BBCA": 100}})
        monkeypatch.setattr(purge_positions, "get_pool", lambda: _ready(pool))

        assert purge_positions.main(["--dry-run"]) == 0
        assert "Every position names a listed ticker" in capsys.readouterr().out

    def test_only_the_unlisted_symbol_is_removed(self, monkeypatch, capsys):
        pool, written = self._pool(["BBCA"], {"pf_1": {"BBCA": 100, "FAKE": 50}})
        monkeypatch.setattr(purge_positions, "get_pool", lambda: _ready(pool))

        assert purge_positions.main([]) == 0
        assert json.loads(written[0][0]) == {"BBCA": 100}

    def test_several_unlisted_symbols_in_one_row_go_together(self, monkeypatch, capsys):
        """Rewriting a row once per symbol would be slower and, with concurrent
        writes, wrong — each pass would be based on a version that no longer exists."""
        pool, written = self._pool(
            ["BBCA"], {"pf_1": {"BBCA": 100, "FAKE": 50, "ALSOFAKE": 20}}
        )
        monkeypatch.setattr(purge_positions, "get_pool", lambda: _ready(pool))

        purge_positions.main([])
        assert len(written) == 1
        assert json.loads(written[0][0]) == {"BBCA": 100}

    def test_running_twice_changes_nothing_the_second_time(self, monkeypatch, capsys):
        """Idempotence: a second run must report nothing left to do.

        A non-zero count on the second run would tell an operator the job is not
        finished, which is worse than a repeated count — they would keep running it.
        """
        pool, _ = self._pool(["BBCA"], {"pf_1": {"BBCA": 100, "FAKE": 50}})
        monkeypatch.setattr(purge_positions, "get_pool", lambda: _ready(pool))
        purge_positions.main([])

        # Same database after the write landed.
        pool_after, written = self._pool(["BBCA"], {"pf_1": {"BBCA": 100}})
        monkeypatch.setattr(purge_positions, "get_pool", lambda: _ready(pool_after))

        assert purge_positions.main([]) == 0
        assert "Every position names a listed ticker" in capsys.readouterr().out
        assert written == []

    def test_an_empty_universe_removes_nothing(self, monkeypatch, capsys):
        """A fresh deployment whose instruments_worker has not run.

        Every symbol would look unlisted, and acting on that would empty every
        portfolio in the system.
        """
        pool, written = self._pool([], {"pf_1": {"BBCA": 100}})
        monkeypatch.setattr(purge_positions, "get_pool", lambda: _ready(pool))

        assert purge_positions.main([]) == 0
        assert "Every position names a listed ticker" in capsys.readouterr().out
        assert written == []


def _ready(pool):
    async def inner():
        return pool

    return inner()


class TestPurgeConsent:
    """Retention for Gate 2 consent rows (ADR-0004).

    The newest row per account is never deleted. It is the answer to "have they
    accepted this?", and removing it would leave an account that can never satisfy
    the gate again without re-consenting — the opposite of what a retention policy
    is for.
    """

    def _pool(self, rows):
        """rows: list of (user_id, version, accepted_at as a datetime)."""
        state = {"deleted": []}

        class Pool:
            async def fetchrow(self, query, *args):
                months = args[0]
                cutoff = _months_ago(months)
                superseded = [
                    r for r in rows
                    if r[2] < cutoff and _has_newer(rows, r)
                ]
                state["superseded"] = superseded
                return {"n": len(superseded)}

            async def execute(self, query, *args):
                state["deleted"].extend(state.get("superseded", []))
                return f"DELETE {len(state['deleted'])}"

        return Pool(), state

    def test_a_dry_run_counts_and_deletes_nothing(self, monkeypatch, capsys):
        pool, state = self._pool([
            ("u1", "v-new", _months_ago(1)),
            ("u1", "v-old", _months_ago(40)),
        ])
        monkeypatch.setattr(purge_consent, "get_pool", lambda: _ready(pool))

        assert purge_consent.main(["--dry-run", "--months", "24"]) == 0
        out = capsys.readouterr().out
        assert "1 consent row" in out
        assert "Nothing was deleted" in out
        assert state["deleted"] == []

    def test_the_newest_row_per_account_is_never_deleted(self, monkeypatch, capsys):
        pool, state = self._pool([
            ("u1", "v-new", _months_ago(1)),
            ("u1", "v-old", _months_ago(40)),
        ])
        monkeypatch.setattr(purge_consent, "get_pool", lambda: _ready(pool))

        purge_consent.main(["--months", "24"])
        deleted_versions = [r[1] for r in state["deleted"]]
        assert deleted_versions == ["v-old"]
        assert "v-new" not in deleted_versions

    def test_a_single_old_row_is_kept(self, monkeypatch, capsys):
        """An account that accepted once, forty months ago, still has a record.

        Deleting it would erase the only evidence they ever consented, and they
        could not satisfy the gate again without doing it a second time.
        """
        pool, state = self._pool([("u1", "only", _months_ago(40))])
        monkeypatch.setattr(purge_consent, "get_pool", lambda: _ready(pool))

        purge_consent.main(["--months", "24"])
        assert state["deleted"] == []
        assert "Nothing older" in capsys.readouterr().out

    def test_two_accounts_are_kept_apart(self, monkeypatch, capsys):
        """One account's new row must not make another account's only row look
        superseded."""
        pool, state = self._pool([
            ("u1", "v-new", _months_ago(1)),
            ("u2", "only", _months_ago(40)),
        ])
        monkeypatch.setattr(purge_consent, "get_pool", lambda: _ready(pool))

        purge_consent.main(["--months", "24"])
        assert state["deleted"] == []

    def test_running_twice_reports_nothing_left(self, monkeypatch, capsys):
        pool, state = self._pool([
            ("u1", "v-new", _months_ago(1)),
            ("u1", "v-old", _months_ago(40)),
        ])
        monkeypatch.setattr(purge_consent, "get_pool", lambda: _ready(pool))

        purge_consent.main(["--months", "24"])
        # Second run: the same database after the delete landed.
        pool_after, state_after = self._pool([("u1", "v-new", _months_ago(1))])
        monkeypatch.setattr(purge_consent, "get_pool", lambda: _ready(pool_after))

        assert purge_consent.main(["--months", "24"]) == 0
        assert "Nothing older" in capsys.readouterr().out
        assert state_after["deleted"] == []

    def test_zero_months_keeps_everything_and_says_so(self, monkeypatch, capsys):
        """Keep-everything is a policy, not an absence of work."""
        pool, state = self._pool([
            ("u1", "v-new", _months_ago(1)),
            ("u1", "v-old", _months_ago(400)),
        ])
        monkeypatch.setattr(purge_consent, "get_pool", lambda: _ready(pool))

        assert purge_consent.main(["--months", "0"]) == 0
        assert "keeping every row" in capsys.readouterr().out
        assert state["deleted"] == []

    def test_a_negative_retention_is_refused(self):
        """A typo must not turn "delete a lot" into something else entirely."""
        with pytest.raises(SystemExit):
            purge_consent.main(["--months", "-1"])


def _months_ago(n):
    from datetime import datetime, timedelta, timezone

    return datetime.now(timezone.utc) - timedelta(days=n * 30)


def _has_newer(rows, row):
    """Mirrors the SQL's EXISTS: same account, ordered after this row.

    The SQL compares `(accepted_at, id)`; the fake has no id, so version stands in
    for it as a stable tiebreak. That is enough here because the rows under test are
    months apart, so accepted_at alone decides.
    """
    return any(
        other[0] == row[0] and (other[2], other[1]) > (row[2], row[1])
        for other in rows
    )
