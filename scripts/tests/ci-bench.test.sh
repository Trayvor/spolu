#!/usr/bin/env bash
# Tests for scripts/ci.sh's --bench flag: off by default, `--bench` or RUN_BENCH=1 passes
# RUN_BENCH=1 to the tests and runs the EXPLAIN suite after the main one (not next to it),
# anything else is a usage error. docker, pnpm, git and shellcheck
# are stubs that only log what they were asked, so nothing real runs.
set -u
SCRIPTS="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

d="$(mktemp -d)"
mkdir -p "$d/repo/scripts/tests" "$d/bin"
cp "$SCRIPTS/ci.sh" "$SCRIPTS/lib.sh" "$d/repo/scripts/"
echo 'exit 0' > "$d/repo/scripts/check-docs.sh"
echo 'exit 0' > "$d/repo/scripts/tests/noop.test.sh"
for cmd in docker git shellcheck; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/bin/$cmd"
done
# pnpm logs each call with the RUN_BENCH it sees (expanded by the stub, not here). The server
# suites also log when they start and end in order.log; the main one takes a moment, so a step
# run next to it starts before it ends.
cat > "$d/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
echo "$* RUN_BENCH=${RUN_BENCH-} WORKERS=${VITEST_MAX_WORKERS-}" >> "$STUB_DIR/pnpm.log"
case "$*" in
  *test:main*) echo "start main" >> "$STUB_DIR/order.log"; sleep 0.5; echo "end main" >> "$STUB_DIR/order.log" ;;
  *test:explain*) echo "start explain" >> "$STUB_DIR/order.log" ;;
esac
exit 0
STUB
chmod +x "$d/bin/"*
export STUB_DIR="$d"

# check <name> <expected RUN_BENCH> <command...>: the command runs ci.sh with the stubs first on PATH.
check() {
  local name="$1" want="$2"
  shift 2
  rm -f "$d/pnpm.log" "$d/order.log"
  local out rc
  out="$(env -u RUN_BENCH PATH="$d/bin:$PATH" "$@" 2>&1)"; rc=$?
  if [[ $rc -ne 0 ]]; then echo "FAIL $name: exit $rc: $out"; fail=1; return; fi
  local got
  got="$(grep ' test' "$d/pnpm.log" 2>/dev/null | grep -v -- '--e2e' | sed 's/.* \(test[^ ]*\) RUN_BENCH=\([^ ]*\).*/\1 RUN_BENCH=\2/' | sort | tr '\n' ';')"
  want_all="test RUN_BENCH=$want;test:explain RUN_BENCH=$want;test:main RUN_BENCH=$want;"
  if [[ "$got" != "$want_all" ]]; then
    echo "FAIL $name: pnpm saw '$got', want '$want_all'"; fail=1
  fi
}

# The EXPLAIN suite runs with one Vitest worker, in the same run_parallel step as the main suite:
# it starts before the main suite ends.
check_explain_workers() {
  rm -f "$d/pnpm.log" "$d/order.log"
  env -u RUN_BENCH PATH="$d/bin:$PATH" bash "$d/repo/scripts/ci.sh" >"$d/out.log" 2>&1
  if ! grep -q 'test:explain .*WORKERS=1$' "$d/pnpm.log"; then
    echo "FAIL explain workers: $(cat "$d/pnpm.log")"; fail=1
  fi
  if ! grep -q '^\[.*\] EXPLAIN tests: ok' "$d/out.log" || ! grep -q '^\[.*\] Tests: ok' "$d/out.log"; then
    echo "FAIL explain step names: $(cat "$d/out.log")"; fail=1
  fi
  if [[ "$(tail -n 1 "$d/order.log")" != "end main" ]]; then
    echo "FAIL explain next to main: $(tr '\n' ';' < "$d/order.log")"; fail=1
  fi
}

# With --bench (or RUN_BENCH=1) the EXPLAIN suite times its queries, so it runs alone, after the
# main suite ends, still with one worker and not as a run_parallel step.
check_bench_explain_after_main() {
  local name="$1"
  shift
  rm -f "$d/pnpm.log" "$d/order.log"
  env -u RUN_BENCH PATH="$d/bin:$PATH" "$@" >"$d/out.log" 2>&1
  if [[ "$(tr '\n' ';' < "$d/order.log")" != "start main;end main;start explain;" ]]; then
    echo "FAIL $name: explain not after main: $(tr '\n' ';' < "$d/order.log")"; fail=1
  fi
  if ! grep -q 'test:explain .*RUN_BENCH=1 WORKERS=1$' "$d/pnpm.log"; then
    echo "FAIL $name: explain workers: $(cat "$d/pnpm.log")"; fail=1
  fi
  if grep -q 'EXPLAIN tests: ok' "$d/out.log"; then
    echo "FAIL $name: explain still a parallel step: $(cat "$d/out.log")"; fail=1
  fi
}

check "default" "" bash "$d/repo/scripts/ci.sh"
check "--bench" "1" bash "$d/repo/scripts/ci.sh" --bench
check "RUN_BENCH=1" "1" RUN_BENCH=1 bash "$d/repo/scripts/ci.sh"

check_explain_workers
check_bench_explain_after_main "--bench order" bash "$d/repo/scripts/ci.sh" --bench
check_bench_explain_after_main "RUN_BENCH=1 order" env RUN_BENCH=1 bash "$d/repo/scripts/ci.sh"

for args in "--fast" "--bench --bench" "extra"; do
  # shellcheck disable=SC2086 # split the arguments on purpose
  out="$(env -u RUN_BENCH PATH="$d/bin:$PATH" bash "$d/repo/scripts/ci.sh" $args 2>&1)"; rc=$?
  if [[ $rc -ne 2 || "$out" != *"--bench"* ]]; then
    echo "FAIL '$args': want usage (exit 2), got exit $rc: $out"; fail=1
  fi
done

rm -rf "$d"
[[ $fail -eq 0 ]] && echo "ci-bench.test.sh: all passed"
exit $fail
