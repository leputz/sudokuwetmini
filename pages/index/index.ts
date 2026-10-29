// pages/index/index.ts
import { solveSudoku, printBoard } from '../../utils/sudokuSolver';

Page({
  data: {
    imagePath: '',
    isModelReady: false,
    session: null as any,
    recognizedBoard: [] as number[][],
    solvedBoard: [] as number[][],
    solvedImagePath: '', // ⚠️ 新增：存放带答案的图片路径
    debugImageBase64: '' // ⚠️ 换成了 Base64 存储
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
    console.log("1. 开始处理图片...");

    wx.createSelectorQuery()
      .select('#sudokuCanvas')
      .fields({ node: true, size: true })
      .select('#debugCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res[0] || !res[0].node || !res[1] || !res[1].node) {
          console.error("❌ 找不到 Canvas");
          wx.hideLoading();
          return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const debugCanvas = res[1].node;
        const debugCtx = debugCanvas.getContext('2d');
        
        const canvasSize = 450; 
        canvas.width = canvasSize;
        canvas.height = canvasSize;

        const img = canvas.createImage();
        img.onload = async () => {
          console.log("2. 图片加载成功，绘制到主画布");
          ctx.drawImage(img, 0, 0, canvasSize, canvasSize);
          const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
          const rgba = imageData.data;

          const bounds = this.findSudokuBounds(rgba, canvasSize);
          console.log("3. 数独边界计算结果:", bounds);

          if (bounds.width < 150 || bounds.height < 150) {
            console.warn("⚠️ 数独区域太小，停止处理");
            wx.hideLoading();
            wx.showToast({ title: '未找到数独网格', icon: 'none' });
            return;
          }

          const board: number[][] = Array(9).fill(0).map(() => Array(9).fill(0));
          const cellWidth = bounds.width / 9;
          const cellHeight = bounds.height / 9;

          // ⚠️ 缩小 Debug 尺寸，防止 Base64 超过 1MB 导致 setData 失败
          const debugCellSize = 30;
          const debugPadding = 2;
          debugCanvas.width = 9 * (debugCellSize + debugPadding);
          debugCanvas.height = 9 * (debugCellSize + debugPadding);
          debugCtx.fillStyle = '#888888';
          debugCtx.fillRect(0, 0, debugCanvas.width, debugCanvas.height);

          const tempCanvas = wx.createOffscreenCanvas({type: '2d', width: 28, height: 28});
          const tempCtx = tempCanvas.getContext('2d');

          console.log("4. 开始循环切分 81 个格子...");

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

              // 还原像素画到 Debug Canvas
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

          console.log("5. 81个格子绘制完毕，尝试转换 Base64...");
          
          // 转换 Base64
          const debugBase64 = debugCanvas.toDataURL('image/png');
          console.log("6. Base64 长度:", debugBase64.length);
          
          // 核心：加一个回调查看是否设置成功
          this.setData({ 
            debugImageBase64: debugBase64 
          }, () => {
            console.log("7. setData 回调成功，UI应该更新了！");
          });

          wx.hideLoading();
          printBoard(board, "Recognized Board");
          this.setData({ recognizedBoard: board });

          // 求解逻辑
          const solved = JSON.parse(JSON.stringify(board));
          if (solveSudoku(solved)) {
            printBoard(solved, "Solved Board");
            this.setData({ solvedBoard: solved });

            // 绘制答案
            ctx.clearRect(0, 0, canvasSize, canvasSize);
            ctx.drawImage(img, 0, 0, canvasSize, canvasSize);
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
              wx.showToast({ title: '求解成功', icon: 'success' });
            }, 100);

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

  extractCellWithBoundingBox(
    rgbaData: Uint8ClampedArray, 
    startX: number, 
    startY: number, 
    cellW: number, 
    cellH: number, 
    canvasWidth: number
  ): Float32Array {
    const float32Data = new Float32Array(28 * 28);
    
    const marginW = Math.floor(cellW * 0.15); // 稍微缩小一点 margin，保留更多笔画
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
        
        // 计算灰度值
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;

        // ⚠️ 去掉强行二值化，保留真实的灰度渐变！
        // 仅仅用一个极端的阈值来判断这个格子是不是彻底空白
        if (gray < 100) {
          hasBlackPixel = true;
        }

        // 归一化到 [-1, 1] (黑是 -1，白是 1)
        float32Data[y * 28 + x] = (gray / 255.0 - 0.5) / 0.5;
      }
    }

    // 如果整个格子内几乎没有黑像素，说明是空白格，填满纯白
    if (!hasBlackPixel) {
      float32Data.fill(1.0); 
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
        
        // ⚠️ 打印原始分数和预测结果（如果你刚才的图里有 1，看看它预测为 4 时的分数是多少）
        // console.log(`[诊断] 预测: ${maxIndex}, 分数: ${maxValue.toFixed(4)}`);
        
        // ⚠️ 这里的 0.65 阈值，如果你不信任，可以暂时改成 -999（即永远不判为空白）
        resolve(maxValue < 0.65 && maxIndex !== 0 ? 0 : maxIndex);
      }).catch((err) => {
        console.error("推理失败", err);
        resolve(0);
      });
    });
  },
});
