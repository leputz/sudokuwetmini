Page({
  data: {
    imagePath: '', // 选中的图片临时路径
    session: null as any, // 保存推理 session，供后续使用
    isModelReady: false,
  },

  onLoad() {
    // 1. 页面加载时，先去加载模型
    this.testFindOnnx();
  },

  // ================= 模块 1：加载模型 =================
  testFindOnnx() {
    const fs = wx.getFileSystemManager();
    const path = 'data/digitnet_sim.png'; // 代码包里的文件
    const localPath = `${wx.env.USER_DATA_PATH}/digitnet.onnx`; // 本地真实路径
    
    try {
      fs.accessSync(path);
      console.log("✅ ONNX file found! Path:", path);
      
      fs.copyFileSync(path, localPath);
      console.log("✅ Successfully copied to local storage:", localPath);
      
      this.createSession(localPath);
      
    } catch (e) {
      console.error("❌ File not found or copy failed:", e);
    }
  },

  createSession(modelPath: string) {
    console.log("Loading model...");
    const session = (wx as any).createInferenceSession({
      model: modelPath,
      precisionLevel: 4,
      allowNPU: false,
      allowQuantize: false,
      typicalShape: {
        input: [1, 1, 28, 28]
      }
    });
  
    session.onLoad(() => {
      console.log('🎉 ONNX model loaded successfully! Ready to run inference.');
      // 模型加载成功，保存 session，更新状态
      this.setData({ 
        session: session,
        isModelReady: true 
      });
      wx.showToast({ title: '模型已就绪', icon: 'success' });
    });
  
    session.onError((error: any) => {
      console.error('❌ Model loading failed:', error);
    });
  },

  // ================= 模块 2：拍照 / 选图 =================
  chooseImage() {
    // ... 前面的代码保持不变 ...
    wx.chooseMedia({
      // ...
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        console.log("✅ 成功获取图片路径:", tempFilePath);
        
        this.setData({ imagePath: tempFilePath });

        // ⚠️ 在这里调用图片处理逻辑
        this.processImage(tempFilePath); 
      },
      // ...
    });
  },

  // ================= 模块 3：Canvas 提取像素 =================
  processImage(imgPath: string) {
    console.log("开始处理图片...");
    
    // 1. 获取 Canvas 节点
    wx.createSelectorQuery()
      .select('#imageCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) {
          console.error("❌ 找不到 Canvas 节点");
          return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');

        // 2. 设置画布大小 (256x256，方便后续处理，也防止内存溢出)
        canvas.width = 256;
        canvas.height = 256;

        // 3. 创建图片对象
        const img = canvas.createImage();
        
        img.onload = () => {
          console.log("✅ 图片加载成功，尺寸:", img.width, "x", img.height);

          // 4. 将图片绘制到 Canvas 上（先简单拉伸铺满 256x256）
          ctx.drawImage(img, 0, 0, 256, 256);

          // 5. 提取像素数据
          // 返回的 imageData.data 是一个 Uint8ClampedArray
          // 里面按 R, G, B, A (红,绿,蓝,透明度) 的顺序排列，每 4 个数字代表一个像素
          const imageData = ctx.getImageData(0, 0, 256, 256);
          const pixelData = imageData.data;
          
          console.log("✅ 成功提取像素数据！数组长度:", pixelData.length); // 256 * 256 * 4 = 262144
          
          // 6. 接下来我们将它转换成模型需要的 28x28 灰度 Float32Array
          this.convertToModelInput(pixelData, 256, 256);
        };

        img.onerror = (err: any) => {
          console.error("❌ 图片加载失败:", err);
        };

        // 加载临时路径的图片
        img.src = imgPath;
      });
  },

  // ================= 模块 4：像素转灰度并送入模型 =================
  convertToModelInput(rgbaData: Uint8ClampedArray, width: number, height: number) {
    // 模型需要 28x28 的 Float32Array，共 784 个数据
    const float32Data = new Float32Array(28 * 28);

    // 计算缩放比例（从 256 缩放到 28）
    const scaleX = width / 28;
    const scaleY = height / 28;

    // 遍历 28x28 的网格
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        // 找到对应的原图坐标
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);

        // 计算在原图一维数组中的索引 (RGBA 4个通道)
        const index = (srcY * width + srcX) * 4;

        const r = rgbaData[index];
        const g = rgbaData[index + 1];
        const b = rgbaData[index + 2];

        // 灰度化公式（标准 ITU-R BT.601）
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        // 归一化：将 0-255 映射到 [-1, 1]
        const normalized = (gray / 255.0 - 0.5) / 0.5;

        // 存入数组
        float32Data[y * 28 + x] = normalized;
      }
    }

    console.log("✅ 成功转换为 28x28 数组，准备推理");

    // 7. 调用模型进行推理
    this.runInference(float32Data);
  },

  // ================= 模块 5：执行推理 =================
  runInference(inputData: Float32Array) {
    const session = this.data.session;
    if (!session) {
      console.error("❌ 模型未就绪");
      return;
    }

    const inputTensor = {
      type: 'float32',
      data: inputData.buffer,
      shape: [1, 1, 28, 28]
    };

    session.run({
      input: inputTensor 
    }).then((outputs: any) => {
      const outputData = new Float32Array(outputs.logits.data);
      
      let maxIndex = 0;
      let maxValue = -Infinity;
      for (let i = 0; i < outputData.length; i++) {
        if (outputData[i] > maxValue) {
          maxValue = outputData[i];
          maxIndex = i;
        }
      }
      
      console.log(`🏆 真实图片推理结果: ${maxIndex}, 置信度: ${maxValue}`);
      wx.showToast({ title: `识别结果: ${maxIndex}`, icon: 'none' });
      
    }).catch((err: any) => {
      console.error("❌ 推理失败:", err);
    });
  }
});