# Reviewing Property-Based Tests

A property test can pass for years while asserting nothing. These are the ways that
happens, worst first.

Report every issue you find with its severity attached. Do not decide on the author's
behalf that a MEDIUM is not worth mentioning.

| Issue                     | Severity | How it shows up                                                  |
| ------------------------- | -------- | ---------------------------------------------------------------- |
| Tautological              | CRITICAL | Assertion is true regardless of the implementation               |
| Vacuous                   | CRITICAL | `fc.pre()` filters out nearly everything, or contradicts itself  |
| No assertion              | HIGH     | Body calls the function and stops                                |
| Reimplementation          | HIGH     | Assertion recomputes the function's own logic                    |
| Weaker property available | MEDIUM   | Length checked, ordering not                                     |
| Over-filtered             | MEDIUM   | Stacked `fc.pre()` where an arbitrary constraint belongs         |
| Settings                  | LOW      | `numRuns: 5`, or a run count too high for an expensive arbitrary |

## Tautological

```js
fc.assert(
  fc.property(fc.integer(), (x) => {
    const result = compute(x);
    assert.equal(result, result);
  }),
);
```

Nothing about `compute` can make this fail.

But `f(x) == f(x)` is not automatically tautological. It is a real determinism
property whenever `f` is not obviously pure: serializers over objects or Sets, anything
touching iteration order, hashing, or time. `JSON.stringify(build(x)) === JSON.stringify(build(x))`
genuinely fails when `build` iterates a Set or reads the clock. Ask whether a broken
implementation could falsify it. If yes, it is a property; if no, it is noise.

## Vacuous

```js
fc.assert(
  fc.property(fc.integer(), (x) => {
    fc.pre(x > 100);
    fc.pre(x < 50);
    assert.ok(compute(x) > 0);
  }),
);
```

fast-check fails this only after skipping too many runs, and a looser version passes
having run a handful of cases. `fc.pre(x === 42)` is the subtler version: it runs, it
passes, and it is an example test wearing `fc.property`.

## Reimplementation

```js
fc.assert(
  fc.property(fc.integer(), fc.integer(), (a, b) => {
    assert.equal(add(a, b), a + b);
  }),
);
```

If `add` is `a + b`, this asserts `a + b == a + b`. The test survives any bug the two
expressions share. Reach for an algebraic property instead (commutativity, identity,
associativity), which constrains the function without restating it.

## Finding the tests

```bash
rg "fc\.(assert|property)" --type ts --type js
```

## What to push for

Compare each test against the property catalog in SKILL.md and name the strongest
property the code supports but the suite does not assert. A suite that checks
`len(sort(xs)) == len(xs)` and never checks ordering is the common case.

Also worth flagging: floating-point equality without a tolerance, assertions on
object, Map or Set iteration order, and anything reading the clock: these produce flakes that
get blamed on fast-check and then get deleted.
