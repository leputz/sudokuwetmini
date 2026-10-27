
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
      
      const fakeInputData = new Float32Array(784).fill(0);
      
      // ⚠️ 关键：必须包含 type 字段，且值必须是 'float32'
      const inputTensor = {
        type: 'float32',            // 必须声明数据类型
        data: fakeInputData.buffer, // 必须是 ArrayBuffer
        shape: [1, 1, 28, 28]       // NCHW 顺序
      };
  
      console.log("开始执行推理...");
      
      // ⚠️ 键名 'input' 必须与模型输入节点名完全一致
      session.run({
        input: inputTensor 
      }).then((outputs: any) => {
        console.log("✅ 推理成功！完整返回对象:", outputs);
        
        // 你的模型输出节点名为 'logits'
        const outputData = outputs.logits.data;
        console.log("📊 预测分数:", outputData);
        
        let maxIndex = 0;
        let maxValue = -Infinity;
        for (let i = 0; i < outputData.length; i++) {
          if (outputData[i] > maxValue) {
            maxValue = outputData[i];
            maxIndex = i;
          }
        }
        
        console.log(`🏆 预测结果: ${maxIndex}`);
        wx.showToast({ title: `预测: ${maxIndex}`, icon: 'none' });
        
      }).catch((err: any) => {
        console.error("❌ 推理失败:", err);
      });
    });
  
    session.onError((error: any) => {
      console.error('❌ 模型加载失败:', error);
    });
  }
});