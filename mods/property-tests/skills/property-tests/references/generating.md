# Generating Property-Based Tests

Writing `fc.assert(fc.property(...))` is the easy part. These are the decisions that
make the difference between a suite that finds bugs and one that just runs.

## Put constraints in the arbitrary, not in `fc.pre()`

This is the single highest-value habit. `fc.pre()` and `.filter()` discard inputs
after generation, so a filter that rejects most candidates wastes the run budget and
can end with fast-check giving up on too many skipped runs.

```js
// Slow, and mostly discards
fc.assert(
  fc.property(fc.integer(), (x) => {
    fc.pre(x > 0);
    // ...
  }),
);

// Generates only what you want
fc.assert(
  fc.property(fc.integer({min: 1}), (x) => {
    // ...
  }),
);
```

Reserve `fc.pre()` for conditions you genuinely cannot express as an arbitrary, usually
a relationship between two already-generated values.

Build compound inputs with `fc.record` or `fc.tuple`, and derive dependent fields with
`.chain` rather than generating independently and filtering:

```js
const listAndIndex = fc
  .array(fc.integer(), {minLength: 1})
  .chain((xs) => fc.tuple(fc.constant(xs), fc.nat({max: xs.length - 1})));
```

## Pin the edge cases you already know about

Random generation finds boundaries eventually; the `examples` option runs them on every
run and documents that you thought about them.

```js
fc.assert(
  fc.property(fc.array(fc.integer()), (xs) => {
    /* ... */
  }),
  {
    examples: [[[]], [[1]], [[1, 1, 1]]],
  },
);
```

Empty, single-element, all-duplicates, zero, negative, and the maximum representable
value are the ones that recur.

## Settings

The default of 100 runs is wrong at both ends of the workflow:

```js
fc.assert(prop, {numRuns: 10}); // local iteration
fc.assert(prop, {numRuns: 200}); // CI
fc.assert(prop, {numRuns: 1000}); // nightly
```

A failure prints its `seed` and `path`; pass both back to `fc.assert` to replay that
exact case instead of hoping the next random run finds it again.

## Determinism as a property

`f(x) === f(x)` is a tautology for a pure function and a real test for anything else.
Serializers over objects, Maps or Sets, anything involving hashing, iteration order, or
time can and do return different output for the same input. Assert it where a broken
implementation could falsify it, and not otherwise.

## Testing the error path

`fc.string()` or `fc.uint8Array()` against a parser is worth writing: the contract is
usually "throws the documented error or succeeds, never a TypeError, never hangs".
Catch only the documented error and let everything else fail the test.
