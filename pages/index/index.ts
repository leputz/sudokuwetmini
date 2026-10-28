// pages/index/index.ts
import { solveSudoku, printBoard } from '../../utils/sudokuSolver';

Page({
  data: {
    imagePath: '',
    isModelReady: false,
    session: null as any,
    recognizedBoard: [] as number[][],
    solvedBoard: [] as number[][],
  },

  onLoad() {
    this.loadModel();
  },

  // ================= 1. 加载模型 =================
  loadModel() {
    const fs = wx.getFileSystemManager();
    // 你的模型文件放在 data 目录下
    const packagePath = 'data/digitnet_sim.png'; 
    const localPath = `${wx.env.USER_DATA_PATH}/digitnet.onnx`;
    
    try {
      fs.accessSync(packagePath);
      fs.copyFileSync(packagePath, localPath);
      console.log("✅ 模型复制到本地成功:", localPath);
      this.createSession(localPath);
    } catch (e) {
      console.error("❌ 模型加载失败:", e);
      wx.showToast({ title: '模型文件找不到', icon: 'none' });
    }
  },

  createSession(modelPath: string) {
    const session = (wx as any).createInferenceSession({
      model: modelPath,
      precisionLevel: 4,
      typicalShape: { input: [1, 1, 28, 28] }
    });

    session.onLoad(() => {
      console.log('🎉 ONNX 模型加载成功！');
      this.setData({ session, isModelReady: true });
      wx.showToast({ title: '模型已就绪', icon: 'success' });
    });

    session.onError((err: any) => console.error('❌ 模型加载失败:', err));
  },

  // ================= 2. 选择图片 =================
  chooseImage() {
    if (!this.data.isModelReady) {
      wx.showToast({ title: '模型未就绪', icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.setData({ imagePath: tempFilePath, recognizedBoard: [], solvedBoard: [] });
        this.processFullImage(tempFilePath);
      }
    });
  },

  // ================= 3. 处理图片并识别 =================
  processFullImage(imgPath: string) {
    wx.showLoading({ title: '正在识别数独...', mask: true });

    wx.createSelectorQuery()
      .select('#sudokuCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        
        // 统一缩放到 450x450 的画布
        const canvasSize = 450; 
        canvas.width = canvasSize;
        canvas.height = canvasSize;

        const img = canvas.createImage();
        img.onload = async () => {
          ctx.drawImage(img, 0, 0, canvasSize, canvasSize);
          const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
          const rgba = imageData.data;

          // 自动寻找数独网格大边界
          const bounds = this.findSudokuBounds(rgba, canvasSize);
          if (bounds.width < 150 || bounds.height < 150) {
            wx.hideLoading();
            wx.showToast({ title: '未找到数独网格', icon: 'none' });
            return;
          }

          const board: number[][] = Array(9).fill(0).map(() => Array(9).fill(0));
          const cellWidth = bounds.width / 9;
          const cellHeight = bounds.height / 9;

          // 切分 81 个格子
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
              
              const digit = await this.runInference(float32Data);
              board[r][c] = digit;
            }
          }

          wx.hideLoading();
          printBoard(board, "Recognized Board");
          this.setData({ recognizedBoard: board });

          // 求解
          const solved = JSON.parse(JSON.stringify(board));
          if (solveSudoku(solved)) {
            printBoard(solved, "Solved Board");
            this.setData({ solvedBoard: solved });
            wx.showToast({ title: '求解成功', icon: 'success' });
          } else {
            wx.showToast({ title: '无解，可能识别有误', icon: 'none' });
          }
        };
        img.src = imgPath;
      });
  },

  // 扫描全图，找到 9x9 边框的位置
  findSudokuBounds(rgba: Uint8ClampedArray, width: number) {
    let minX = width, maxX = 0, minY = width, maxY = 0;
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const gray = 0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2];
        if (gray < 100) { // 黑色线条
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  },

  // 提取单格并居中缩放至 28x28
  extractCellWithBoundingBox(rgbaData: Uint8ClampedArray, startX: number, startY: number, cellW: number, cellH: number, canvasWidth: number): Float32Array {
    cellW = Math.max(cellW, 1); cellH = Math.max(cellH, 1);
    const padding = 4; 
    let minX = cellW, maxX = 0, minY = cellH, maxY = 0;
    let foundDigit = false;

    for (let y = padding; y < cellH - padding; y++) {
      for (let x = padding; x < cellW - padding; x++) {
        const absX = startX + x, absY = startY + y;
        if (absX >= canvasWidth || absY >= canvasWidth) continue;
        const index = (absY * canvasWidth + absX) * 4;
        const gray = 0.299 * rgbaData[index] + 0.587 * rgbaData[index + 1] + 0.114 * rgbaData[index + 2];
        if (gray < 120) {
          foundDigit = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }

    const float32Data = new Float32Array(28 * 28);
    if (!foundDigit) {
      float32Data.fill(1.0); // 空白格填白
      return float32Data;
    }

    const boxSize = Math.max(maxX - minX + 1, maxY - minY + 1) + 6;
    const startBoxX = Math.floor(minX + (maxX - minX + 1) / 2 - boxSize / 2);
    const startBoxY = Math.floor(minY + (maxY - minY + 1) / 2 - boxSize / 2);
    const scale = boxSize / 28;

    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        const srcX = startBoxX + Math.floor(x * scale);
        const srcY = startBoxY + Math.floor(y * scale);

        if (srcX < 0 || srcX >= cellW || srcY < 0 || srcY >= cellH) {
          float32Data[y * 28 + x] = 1.0; continue;
        }
        const absX = startX + srcX, absY = startY + srcY;
        if (absX >= canvasWidth || absY >= canvasWidth) {
          float32Data[y * 28 + x] = 1.0; continue;
        }
        const index = (absY * canvasWidth + absX) * 4;
        const gray = 0.299 * rgbaData[index] + 0.587 * rgbaData[index + 1] + 0.114 * rgbaData[index + 2];
        float32Data[y * 28 + x] = (gray / 255.0 - 0.5) / 0.5;
      }
    }
    return float32Data;
  },

  // 单次推理
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
        resolve(maxValue < 0.65 && maxIndex !== 0 ? 0 : maxIndex);
      }).catch(() => resolve(0));
    });
  }
});