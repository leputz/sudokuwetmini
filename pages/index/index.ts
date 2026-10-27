
Page({
  onLoad() {
    this.testFindOnnx();
  },

  testFindOnnx() {
    const fs = wx.getFileSystemManager();
    const path = 'data/digitnet_sim.png'; // Placeholder file bundled with the package
    const localPath = `${wx.env.USER_DATA_PATH}/digitnet.onnx`; // Actual model stored locally
    
    try {
      fs.accessSync(path);
      console.log("✅ ONNX file found! Path:", path);
      
      // Force a copy (overwrite the old file to ensure the model is up to date)
      fs.copyFileSync(path, localPath);
      console.log("✅ Successfully copied to local storage:", localPath);
      
      // After copying successfully, immediately call the method to create a session
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
      
      const fakeInputData = new Float32Array(784).fill(0);
      
      // ⚠️ Important: Must include the type field, and its value must be 'float32'
      const inputTensor = {
        type: 'float32',            // The data type must be declared
        data: fakeInputData.buffer, // Must be an ArrayBuffer
        shape: [1, 1, 28, 28]       // NCHW order
      };
  
      console.log("Running inference...");
      
      // ⚠️ The key 'input' must exactly match the model's input node name
      session.run({
        input: inputTensor 
      }).then((outputs: any) => {
        console.log("✅ Inference succeeded! Full output object:", outputs);
        
        // The model's output node is named 'logits'
        const outputData = outputs.logits.data;
        console.log("📊 Prediction scores:", outputData);
        
        let maxIndex = 0;
        let maxValue = -Infinity;
        for (let i = 0; i < outputData.length; i++) {
          if (outputData[i] > maxValue) {
            maxValue = outputData[i];
            maxIndex = i;
          }
        }
        
        console.log(`🏆 Prediction: ${maxIndex}`);
        wx.showToast({ title: `Prediction: ${maxIndex}`, icon: 'none' });
        
      }).catch((err: any) => {
        console.error("❌ Inference failed:", err);
      });
    });
  
    session.onError((error: any) => {
      console.error('❌ Model loading failed:', error);
    });
  }
});