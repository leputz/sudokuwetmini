
Page({
  onLoad() {
    this.testFindOnnx();
  },

  testFindOnnx() {
    const fs = wx.getFileSystemManager();
    const path = 'data/digitnet_sim.png'; // 代码包里的伪装文件
    const localPath = `${wx.env.USER_DATA_PATH}/digitnet.onnx`; // 本地的真实模型
    
    try {
      fs.accessSync(path);
      console.log("✅ 成功找到 ONNX 文件！路径:", path);
      
      // 强制复制（覆盖旧的，确保一定是最新的模型）
      fs.copyFileSync(path, localPath);
      console.log("✅ 复制到本地成功:", localPath);
      
      // 复制成功后，立刻调用创建 Session 的方法
      this.createSession(localPath);
      
    } catch (e) {
      console.error("❌ 找不到文件或复制失败:", e);
    }
  },

  // 新增：创建推理 Session 并测试推理
  createSession(modelPath: string) {
    console.log("开始加载模型...");
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
      console.log('🎉 ONNX 模型加载成功！可以开始推理了。');
      
      // --- 构造测试数据开始推理 ---
      // 模拟一张 28x28 的黑色图片（像素值全为 0，并归一化到 [-1, 1]）
      const fakeInputData = new Float32Array(28 * 28).fill(0);
      
      const inputTensor = {
        name: 'input',
        shape: [1, 1, 28, 28],
        data: fakeInputData.buffer,
        type: 'float32', // ⚠️ 必须添加类型声明
      };

      console.log("开始执行推理...");
      session.run([inputTensor]).then((outputs: any) => {
        // outputs 是一个数组，outputs[0].data 就是你的预测结果（10个类别的分数）
        const logits = outputs[0].data; 
        console.log("✅ 推理成功！原始输出:", logits);
        
        // 找出最大概率对应的数字
        let maxIndex = 0;
        let maxValue = -Infinity;
        for (let i = 0; i < logits.length; i++) {
          if (logits[i] > maxValue) {
            maxValue = logits[i];
            maxIndex = i;
          }
        }
        
        console.log(`🏆 预测结果是: ${maxIndex}`);
        wx.showToast({ title: `预测: ${maxIndex}`, icon: 'none' });
        
      }).catch((err: any) => {
        console.error("❌ 推理执行失败:", err);
      });
    });

    session.onError((error: any) => {
      console.error('❌ 模型加载失败:', error);
      wx.showToast({ title: '加载模型失败', icon: 'none' });
    });
  }
});