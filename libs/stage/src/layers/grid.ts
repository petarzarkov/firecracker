import { Container, Graphics, Text } from 'pixi.js';
import * as palette from '../palette.js';
import type { Scale } from '../scale.js';

/**
 * The gridlines and their labels.
 *
 * **Both, here, together.** Labels as DOM nodes positioned against a hardcoded
 * reference height, while the lines were drawn against the chart's real one, put the
 * `1x` label 43px below its own line on a 652px chart. Two things describing one axis
 * is what caused it, so there is one: both read {@link Scale}, on the same frame,
 * from the same `y`.
 *
 * It also has to redraw as the axis rescales - a round climbing past its ceiling
 * grows new gridlines - so redrawing was never optional and the DOM half could
 * not have kept up anyway without re-rendering React mid-round.
 */

/** Matches {@link import('../scale.js')}'s cap, so every line has a label ready. */
const MAX_LABELS = 8;

const LABEL_STYLE = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 11,
  fontWeight: '500' as const,
  fill: palette.LABEL,
};

/** How far left of the plot a label hangs. */
const LABEL_GUTTER = 6;

const format = (multiplier: number): string =>
  `${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)}x`;

export interface Grid {
  readonly view: Container;
  update(scale: Scale): void;
}

export const createGrid = (): Grid => {
  const view = new Container();
  const lines = new Graphics();
  view.addChild(lines);

  const labels: Text[] = [];
  for (let i = 0; i < MAX_LABELS; i++) {
    const label = new Text({ text: '', style: LABEL_STYLE });
    label.alpha = palette.LABEL_ALPHA;
    label.anchor.set(0, 0.5);
    label.visible = false;
    labels.push(label);
    view.addChild(label);
  }

  return {
    view,

    update(scale: Scale): void {
      const { plot, grid } = scale;
      lines.clear();

      for (let i = 0; i < MAX_LABELS; i++) {
        const label = labels[i] as Text;
        const multiplier = grid[i];

        if (multiplier === undefined) {
          label.visible = false;
          continue;
        }

        const y = scale.y(multiplier);
        // The ceiling eases, so a line can briefly be above the plot's roof
        // while the axis is still catching up to it.
        if (y < plot.top || y > plot.bottom) {
          label.visible = false;
          continue;
        }

        lines.moveTo(plot.left, y).lineTo(plot.right, y).stroke({
          width: 1,
          color: palette.GRID_LINE,
          alpha: palette.GRID_LINE_ALPHA,
        });

        const text = format(multiplier);
        if (label.text !== text) label.text = text;
        label.visible = true;
        label.x = Math.max(0, plot.left - label.width - LABEL_GUTTER);
        label.y = y;
      }

      // The axes last, so they sit over the gridlines rather than under them.
      lines
        .moveTo(plot.left, plot.top)
        .lineTo(plot.left, plot.bottom)
        .lineTo(plot.right, plot.bottom)
        .stroke({
          width: 1,
          color: palette.GRID_LINE,
          alpha: palette.AXIS_LINE_ALPHA,
        });
    },
  };
};
