// utils/sudokuSolver.ts

export function printBoard(board: number[][], title: string = "Board") {
  console.log(`\n--- ${title} ---`);
  for (let r = 0; r < 9; r++) {
    let row = "";
    for (let c = 0; c < 9; c++) {
      const v = board[r][c];
      row += (v === 0 ? ". " : `${v} `);
      if (c % 3 === 2 && c !== 8) row += "| ";
    }
    console.log(row.trim());
    if (r % 3 === 2 && r !== 8) console.log("---------------------");
  }
}

function isValid(board: number[][], r: number, c: number, v: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (board[r][i] === v) return false; // 行
    if (board[i][c] === v) return false; // 列
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let i = br; i < br + 3; i++) {
    for (let j = bc; j < bc + 3; j++) {
      if (board[i][j] === v) return false; // 宫
    }
  }
  return true;
}

function findEmpty(board: number[][]): [number, number] | null {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) return [r, c];
    }
  }
  return null;
}

export function solveSudoku(board: number[][]): boolean {
  const pos = findEmpty(board);
  if (pos === null) return true;
  const [r, c] = pos;
  for (let v = 1; v <= 9; v++) {
    if (isValid(board, r, c, v)) {
      board[r][c] = v;
      if (solveSudoku(board)) return true;
      board[r][c] = 0;
    }
  }
  return false;
}
