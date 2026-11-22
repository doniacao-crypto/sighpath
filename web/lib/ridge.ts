/**
 * Ridge regression — a port of sklearn's `Ridge` with `fit_intercept=True`, together with the
 * polynomial expansion sklearn's `PolynomialFeatures` produces.
 *
 * The desktop app maps iris position to screen position with a
 * StandardScaler -> PolynomialFeatures -> Ridge pipeline, so the browser has to solve the same
 * normal equations to land on the same numbers.
 */

/** A fitted ridge model: the slope of every design column and the constant term. */
export interface RidgeModel {
  /** One coefficient per column of the design matrix. */
  coefficients: number[];
  /** The constant term added to every prediction. */
  intercept: number;
}

/**
 * Relative pivot size below which the normal equations count as singular. Compared against the
 * largest entry of the matrix so the test means the same thing for a gram matrix of any scale.
 */
const SINGULAR_TOLERANCE = 1e-12;

/**
 * Ridge added to the diagonal when the system turns out to be singular, so the solve still
 * returns a usable (heavily shrunk) model instead of NaN.
 */
const FALLBACK_RIDGE = 1e-8;

/**
 * Solve `matrix * x = rhs` by Gaussian elimination with partial pivoting.
 *
 * Returns null when the matrix is singular, which the caller answers with a fallback. The
 * systems here have at most sixteen unknowns, so plain elimination is exact enough and far
 * easier to trust than an iterative solver.
 */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  let scale = 0;
  for (const row of matrix) {
    for (const value of row) scale = Math.max(scale, Math.abs(value));
  }
  if (scale === 0) return null;

  const augmented = matrix.map((row, index) => [...row, rhs[index]]);

  for (let column = 0; column < size; column += 1) {
    // Partial pivoting: swap the largest pivot into place so the elimination stays stable.
    let pivotRow = column;
    let pivotValue = Math.abs(augmented[column][column]);
    for (let row = column + 1; row < size; row += 1) {
      const candidate = Math.abs(augmented[row][column]);
      if (candidate > pivotValue) {
        pivotValue = candidate;
        pivotRow = row;
      }
    }
    if (pivotValue <= SINGULAR_TOLERANCE * scale) return null;

    if (pivotRow !== column) {
      const swap = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = swap;
    }

    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / augmented[column][column];
      if (factor === 0) continue;
      for (let k = column; k <= size; k += 1) {
        augmented[row][k] -= factor * augmented[column][k];
      }
    }
  }

  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let remaining = augmented[row][size];
    for (let k = row + 1; k < size; k += 1) {
      remaining -= augmented[row][k] * solution[k];
    }
    solution[row] = remaining / augmented[row][row];
  }
  return solution;
}

/**
 * Fit a ridge model the way sklearn's `Ridge(fit_intercept=True)` does: the design matrix and
 * the target are centred, `(X'X + alpha*I) w = X'y` is solved, and the intercept is recovered
 * as `ymean - xmean.w`.
 */
export function fitRidge(
  design: number[][],
  target: number[],
  alpha: number
): RidgeModel {
  const rowCount = design.length;
  if (rowCount === 0 || target.length === 0) {
    return { coefficients: [], intercept: 0 };
  }
  const columnCount = design[0].length;

  const xMean = new Array<number>(columnCount).fill(0);
  for (const row of design) {
    for (let column = 0; column < columnCount; column += 1) {
      xMean[column] += row[column];
    }
  }
  for (let column = 0; column < columnCount; column += 1) {
    xMean[column] /= rowCount;
  }

  let yMean = 0;
  for (const value of target) yMean += value;
  yMean /= target.length;

  const gram: number[][] = [];
  for (let i = 0; i < columnCount; i += 1) {
    gram.push(new Array<number>(columnCount).fill(0));
  }
  const rhs = new Array<number>(columnCount).fill(0);

  for (let row = 0; row < rowCount; row += 1) {
    const centredTarget = target[row] - yMean;
    for (let i = 0; i < columnCount; i += 1) {
      const centredI = design[row][i] - xMean[i];
      rhs[i] += centredI * centredTarget;
      for (let j = 0; j < columnCount; j += 1) {
        gram[i][j] += centredI * (design[row][j] - xMean[j]);
      }
    }
  }

  for (let i = 0; i < columnCount; i += 1) {
    gram[i][i] += alpha;
  }

  let coefficients = solveLinearSystem(gram, rhs);
  if (coefficients === null) {
    // The system is singular: a tiny ridge on the diagonal makes it solvable.
    let diagonal = 0;
    for (let i = 0; i < columnCount; i += 1)
      diagonal = Math.max(diagonal, Math.abs(gram[i][i]));
    const bump = FALLBACK_RIDGE * Math.max(1, diagonal);
    const regularised = gram.map((row, i) =>
      row.map((value, j) => (i === j ? value + bump : value))
    );
    coefficients = solveLinearSystem(regularised, rhs);
  }
  if (coefficients === null) {
    // Nothing sensible to fit: predict the mean of the target rather than NaN.
    return {
      coefficients: new Array<number>(columnCount).fill(0),
      intercept: yMean,
    };
  }

  let intercept = yMean;
  for (let column = 0; column < columnCount; column += 1) {
    intercept -= xMean[column] * coefficients[column];
  }
  return { coefficients, intercept };
}

/** Predict a target value from a design-matrix row. */
export function predict(model: RidgeModel, features: number[]): number {
  let value = model.intercept;
  for (let column = 0; column < model.coefficients.length; column += 1) {
    value += model.coefficients[column] * (features[column] ?? 0);
  }
  return value;
}

/**
 * Expand a feature row into the polynomial terms sklearn's `PolynomialFeatures` produces.
 *
 * The constant comes first, then the terms of degree one, two and so on; within a degree the
 * index tuples run in the order of combinations with repetition, so for four inputs and degree
 * two the order is `1, x1, x2, x3, x4, x1*x1, x1*x2, ... x4*x4`.
 */
export function polynomialFeatures(
  features: number[],
  degree: number
): number[] {
  const expanded: number[] = [1];
  if (degree < 1) return expanded;

  const count = features.length;
  const indices: number[] = [];

  const collect = (start: number, remaining: number): void => {
    if (remaining === 0) {
      let product = 1;
      for (const index of indices) product *= features[index];
      expanded.push(product);
      return;
    }
    for (let index = start; index < count; index += 1) {
      indices.push(index);
      collect(index, remaining - 1);
      indices.pop();
    }
  };

  for (let currentDegree = 1; currentDegree <= degree; currentDegree += 1) {
    collect(0, currentDegree);
  }
  return expanded;
}
