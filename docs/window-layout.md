# Window layout

`WINDOW MODE` supports two layouts:

- `Horizontal` is the compact three-card layout. It intentionally hides the
  MR/LP graph so it can sit beside the game without consuming vertical space.
- `Vertical` stacks the cards and shows the MR/LP graph when ranked match data
  contains at least two points. With zero matches, the graph area shows a
  waiting message instead of a flat line.

The orientation is saved independently for each layout. Switching back to a
previous orientation restores its last size and position. The OBS browser
source always uses the compact overlay layout and therefore does not show the
management graph.
