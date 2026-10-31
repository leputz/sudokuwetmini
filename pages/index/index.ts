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

  // ================= 1. 加载模型 =================
  loadModel() {
    const fs = wx.getFileSystemManager();
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
        // 每次选新图时，清空之前的结果
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
            wx.hideLoading();
            return;
          }
  
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const debugCanvas = res[1].node;
          const debugCtx = debugCanvas.getContext('2d');
          
          const canvasSize = 600; // 画布放大一点，精度更高
          canvas.width = canvasSize;
          canvas.height = canvasSize;
  
          const img = canvas.createImage();
          img.onload = async () => {
            // ================= ⚠️ 核心修复：不拉伸，居中绘制 =================
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
  
            // 调用原来的找边界方法（不强制修正正方形）
            let bounds = this.findSudokuBounds(rgba, canvasSize);
            console.log("3. 原始数独边界:", bounds);
  
            if (bounds.width < 100 || bounds.height < 100) {
              wx.hideLoading();
              wx.showToast({ title: '未找到数独网格', icon: 'none' });
              return;
            }
  
            const board: number[][] = Array(9).fill(0).map(() => Array(9).fill(0));
            const cellWidth = bounds.width / 9;
            const cellHeight = bounds.height / 9;
  
            // 初始化 Debug Canvas
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
  
            // 求解逻辑
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
                wx.showToast({ title: '求解成功', icon: 'success' });
              }, 100);
  
            } else {
              wx.showToast({ title: '无解，可能识别有误', icon: 'none' });
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
        console.error("推理失败", err);
        resolve(0);
      });
    });
  },

  // 保存调试图到相册
  saveDebugImage() {
    console.log("👉 点击了保存按钮");
    const base64Data = this.data.debugImageBase64;
    if (!base64Data) {
      console.log("❌ 没有找到 Base64 数据");
      return;
    }

    const base64Str = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/debug_grid.png`;

    console.log("开始写入文件...");
    fs.writeFile({
      filePath: filePath,
      data: base64Str,
      encoding: "base64",
      success: () => {
        console.log("✅ 写入文件成功，准备保存到相册:", filePath);
        wx.saveImageToPhotosAlbum({
          filePath: filePath,
          success: () => {
            console.log("✅ 成功保存到相册！");
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: (err) => {
            console.error("❌ 保存到相册失败:", err);
            wx.showToast({ title: '保存失败，请检查权限', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        console.error("❌ 写入文件失败:", err);
      }
    });
  },

  // 预览图片
  previewDebugImage() {
    console.log("👉 点击了预览按钮");
    if (!this.data.debugImageBase64) return;
    wx.previewImage({
      urls: [this.data.debugImageBase64]
    });
  }
});