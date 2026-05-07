# vue-star-battle

A Vue 3 implementation of **Star Battle**, the logic puzzle invented by Hans Eendebak for the 2003 World Puzzle Championship.

You may know it as:

- **Queens** — LinkedIn's daily puzzle
- **Kings** — The Almanac (iOS)
- **Two Not Touch** — The New York Times

All are rebrands of the **1★ Star Battle** variant.

## Rules (1★)

Given an *N×N* grid divided into *N* irregular regions:

1. Place exactly **one star** in every row.
2. Place exactly **one star** in every column.
3. Place exactly **one star** in every region.
4. **No two stars may touch** — not horizontally, vertically, or diagonally.

The goal is to find the unique placement that satisfies all four constraints.

## Status

🚧 Scaffolding stage — Vue 3 + Vite project setup pending.

## Roadmap

- [ ] Scaffold Vue 3 + Vite + TypeScript
- [ ] Board component (configurable *N*, region coloring)
- [ ] Puzzle generator (irregular region partitioning + solver-validated unique solutions)
- [ ] Solver (constraint propagation + backtracking)
- [ ] UI: place / mark / clear stars, undo, hint
- [ ] Difficulty levels (small *N* with simple regions → larger *N* with adversarial regions)
- [ ] Daily puzzle mode

## References

- [Star Battle Rules and Info — GMPuzzles](https://www.gmpuzzles.com/blog/star-battle-rules-and-info/)
- [Star Battle — Puzzle Wiki](https://www.puzzles.wiki/wiki/Star_Battle)
- [Queens — LinkedIn](https://www.linkedin.com/help/linkedin/answer/a6269510)
