// pages/index/index.ts
import { solveSudoku, printBoard } from '../../utils/sudokuSolver';

Page({
  data: {
    imagePath: '',
    isModelReady: false,
    session: null as any,
    recognizedBoard: [] as number[][],
    solvedBoard: [] as number[][],
    solvedImagePath: '', 
    debugImageBase64: '' 
  },

  onLoad() {
    this.loadModel();
  },

  // ================= 1. Load Model =================
  loadModel() {
    const fs = wx.getFileSystemManager();
    const packagePath = 'data/digitnet_sim.png'; 
    const localPath = `${wx.env.USER_DATA_PATH}/digitnet.onnx`;
    
    try {
      fs.accessSync(packagePath);
      fs.copyFileSync(packagePath, localPath);
      console.log("✅ Model copied to local storage successfully:", localPath);
      this.createSession(localPath);
    } catch (e) {
      console.error("❌ Model loading failed:", e);
      wx.showToast({ title: 'Model file not found', icon: 'none' });
    }
  },

  createSession(modelPath: string) {
    const session = (wx as any).createInferenceSession({
      model: modelPath,
      precisionLevel: 4,
      typicalShape: { input: [1, 1, 28, 28] }
    });

    session.onLoad(() => {
      console.log('🎉 ONNX model loaded successfully!');
      this.setData({ session, isModelReady: true });
      wx.showToast({ title: 'Model is ready', icon: 'success' });
    });

    session.onError((err: any) => console.error('❌ Model loading failed:', err));
  },

  // ================= 2. Choose Image =================
  chooseImage() {
    if (!this.data.isModelReady) {
      wx.showToast({ title: 'Model not ready', icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // Clear previous results when choosing a new image
        this.setData({ 
          imagePath: tempFilePath, 
          recognizedBoard: [], 
          solvedBoard: [],
          debugImageBase64: '',
          solvedImagePath: ''
        });
        this.processFullImage(tempFilePath);
      }
    });
  },

  // ================= 3. Process Image and Recognize =================
  processFullImage(imgPath: string) {
    wx.showLoading({ title: 'Recognizing Sudoku...', mask: true });
    console.log("1. Start processing image...");

    wx.createSelectorQuery()
      .select('#sudokuCanvas')
      .fields({ node: true, size: true })
      .select('#debugCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res[0] || !res[0].node || !res[1] || !res[1].node) {
          wx.hideLoading();
          return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const debugCanvas = res[1].node;
        const debugCtx = debugCanvas.getContext('2d');
        
        const canvasSize = 600; // Larger canvas for higher precision
        canvas.width = canvasSize;
        canvas.height = canvasSize;

        const img = canvas.createImage();
        img.onload = async () => {
          // ================= ⚠️ Core fix: No stretching, draw centered =================
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasSize, canvasSize);
          
          const scale = Math.min(canvasSize / img.width, canvasSize / img.height);
          const newW = img.width * scale;
          const newH = img.height * scale;
          const offsetX = (canvasSize - newW) / 2;
          const offsetY = (canvasSize - newH) / 2;
          
          ctx.drawImage(img, offsetX, offsetY, newW, newH);
          
          const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
          const rgba = imageData.data;

          // Call the original boundary finding method (no forced square correction)
          let bounds = this.findSudokuBounds(rgba, canvasSize);
          console.log("3. Original Sudoku bounds:", bounds);

          if (bounds.width < 100 || bounds.height < 100) {
            wx.hideLoading();
            wx.showToast({ title: 'Sudoku grid not found', icon: 'none' });
            return;
          }

          const board: number[][] = Array(9).fill(0).map(() => Array(9).fill(0));
          const cellWidth = bounds.width / 9;
          const cellHeight = bounds.height / 9;

          // Initialize Debug Canvas
          const debugCellSize = 30;
          const debugPadding = 2;
          debugCanvas.width = 9 * (debugCellSize + debugPadding);
          debugCanvas.height = 9 * (debugCellSize + debugPadding);
          debugCtx.fillStyle = '#888888';
          debugCtx.fillRect(0, 0, debugCanvas.width, debugCanvas.height);

          const tempCanvas = wx.createOffscreenCanvas({type: '2d', width: 28, height: 28});
          const tempCtx = tempCanvas.getContext('2d');

          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              const startX = bounds.x + c * cellWidth;
              const startY = bounds.y + r * cellHeight;
              
              const float32Data = this.extractCellWithBoundingBox(
                rgba, 
                Math.floor(startX), Math.floor(startY), 
                Math.floor(cellWidth), Math.floor(cellHeight), 
                canvasSize
              );

              const imgData = tempCtx.createImageData(28, 28);
              for (let i = 0; i < 28 * 28; i++) {
                const val = Math.floor((float32Data[i] * 0.5 + 0.5) * 255);
                const idx = i * 4;
                imgData.data[idx] = val;
                imgData.data[idx + 1] = val;
                imgData.data[idx + 2] = val;
                imgData.data[idx + 3] = 255;
              }
              tempCtx.putImageData(imgData, 0, 0);
              
              const dx = c * (debugCellSize + debugPadding) + debugPadding;
              const dy = r * (debugCellSize + debugPadding) + debugPadding;
              debugCtx.drawImage(tempCanvas, 0, 0, 28, 28, dx, dy, debugCellSize, debugCellSize);

              const digit = await this.runInference(float32Data);
              board[r][c] = digit;
            }
          }

          const debugBase64 = debugCanvas.toDataURL('image/png');
          this.setData({ debugImageBase64: debugBase64 });

          wx.hideLoading();
          printBoard(board, "Recognized Board");
          this.setData({ recognizedBoard: board });

          // ⚠️ Add this step: Correct missed digits based on Sudoku rules
          this.sudokuPostProcess(board);
          printBoard(board, "Post-processed Board"); // Check the corrected result

          // Solving logic
          const solved = JSON.parse(JSON.stringify(board));
          if (solveSudoku(solved)) {
            printBoard(solved, "Solved Board");
            this.setData({ solvedBoard: solved });

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvasSize, canvasSize);
            ctx.drawImage(img, offsetX, offsetY, newW, newH);
            
            ctx.fillStyle = '#00AA00'; 
            ctx.font = `bold ${Math.floor(cellHeight * 0.6)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let r = 0; r < 9; r++) {
              for (let c = 0; c < 9; c++) {
                if (board[r][c] === 0) {
                  const textX = bounds.x + c * cellWidth + cellWidth / 2;
                  const textY = bounds.y + r * cellHeight + cellHeight / 2;
                  ctx.fillText(solved[r][c].toString(), textX, textY);
                }
              }
            }

            setTimeout(() => {
              const solvedBase64 = canvas.toDataURL('image/png');
              this.setData({ solvedImagePath: solvedBase64 });
              wx.showToast({ title: 'Solved successfully', icon: 'success' });
            }, 100);

          } else {
            wx.showToast({ title: 'No solution, recognition may be incorrect', icon: 'none' });
          }
        };
        img.src = imgPath;
      });
  },

  findSudokuBounds(rgba: Uint8ClampedArray, width: number) {
    let minX = width, maxX = 0, minY = width, maxY = 0;
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const gray = 0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2];
        if (gray < 100) { // Black lines
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  },

  extractCellWithBoundingBox(
    rgbaData: Uint8ClampedArray, 
    startX: number, 
    startY: number, 
    cellW: number, 
    cellH: number, 
    canvasWidth: number
  ): Float32Array {
    const float32Data = new Float32Array(28 * 28);
    
    const marginW = Math.floor(cellW * 0.15); 
    const marginH = Math.floor(cellH * 0.15);
    
    const validW = cellW - 2 * marginW;
    const validH = cellH - 2 * marginH;
    const scaleX = validW / 28;
    const scaleY = validH / 28;

    let hasBlackPixel = false;

    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        const srcX = startX + marginW + Math.floor(x * scaleX);
        const srcY = startY + marginH + Math.floor(y * scaleY);

        const safeX = Math.min(Math.max(srcX, 0), canvasWidth - 1);
        const safeY = Math.min(Math.max(srcY, 0), canvasWidth - 1);
        
        const index = (safeY * canvasWidth + safeX) * 4;
        const r = rgbaData[index];
        const g = rgbaData[index + 1];
        const b = rgbaData[index + 2];
        
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;

        if (gray < 100) {
          hasBlackPixel = true;
        }

        float32Data[y * 28 + x] = (gray / 255.0 - 0.5) / 0.5;
      }
    }

    if (!hasBlackPixel) {
      float32Data.fill(1.0); 
    }

    return float32Data;
  },

  runInference(inputData: Float32Array): Promise<number> {
    return new Promise((resolve) => {
      const session = this.data.session;
      if (!session) return resolve(0);

      session.run({
        input: { type: 'float32', data: inputData.buffer, shape: [1, 1, 28, 28] }
      }).then((outputs: any) => {
        const outputData = new Float32Array(outputs.logits.data);
        
        let maxIndex = 0, maxValue = -Infinity;
        for (let i = 0; i < outputData.length; i++) {
          if (outputData[i] > maxValue) { maxValue = outputData[i]; maxIndex = i; }
        }
        
        //resolve(maxValue < 0.65 && maxIndex !== 0 ? 0 : maxIndex);
        resolve(maxValue < 0.50 && maxIndex !== 0 ? 0 : maxIndex);
      }).catch((err) => {
        console.error("Inference failed", err);
        resolve(0);
      });
    });
  },

  // Save debug image to album
  saveDebugImage() {
    console.log("👉 Clicked save button");
    const base64Data = this.data.debugImageBase64;
    if (!base64Data) {
      console.log("❌ No Base64 data found");
      return;
    }

    const base64Str = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/debug_grid.png`;

    console.log("Start writing to file...");
    fs.writeFile({
      filePath: filePath,
      data: base64Str,
      encoding: "base64",
      success: () => {
        console.log("✅ File written successfully, ready to save to album:", filePath);
        wx.saveImageToPhotosAlbum({
          filePath: filePath,
          success: () => {
            console.log("✅ Successfully saved to album!");
            wx.showToast({ title: 'Saved to album', icon: 'success' });
          },
          fail: (err) => {
            console.error("❌ Failed to save to album:", err);
            wx.showToast({ title: 'Save failed, please check permissions', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        console.error("❌ Failed to write file:", err);
      }
    });
  },

  // Preview image
  previewDebugImage() {
    console.log("👉 Clicked preview button");
    if (!this.data.debugImageBase64) return;
    wx.previewImage({
      urls: [this.data.debugImageBase64]
    });
  },

  // Post-processing correction based on Sudoku rules
  sudokuPostProcess(board: number[][]) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          // If current cell is empty (0), try to fill it using Sudoku rules
          if (board[r][c] === 0) {
            const possible = [1, 2, 3, 4, 5, 6, 7, 8, 9];
            // 1. Exclude existing numbers in the same row and column
            for (let i = 0; i < 9; i++) {
              if (board[r][i] !== 0) possible[board[r][i] - 1] = 0;
              if (board[i][c] !== 0) possible[board[i][c] - 1] = 0;
            }
            // 2. Exclude existing numbers in the same 3x3 block
            const br = Math.floor(r / 3) * 3;
            const bc = Math.floor(c / 3) * 3;
            for (let i = br; i < br + 3; i++) {
              for (let j = bc; j < bc + 3; j++) {
                if (board[i][j] !== 0) possible[board[i][j] - 1] = 0;
              }
            }

            // 3. If only one possible number remains after filtering, it means the model likely missed it, force fill it in
            const validNumbers = possible.filter(v => v !== 0);
            if (validNumbers.length === 1) {
              board[r][c] = validNumbers[0];
              changed = true;
              console.log(`🔧 Auto-corrected: Row ${r}, Col ${c} missed, auto-filled with ${validNumbers[0]}`);
            }
          }
        }
      }
    }
  },
});