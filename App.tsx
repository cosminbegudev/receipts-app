import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  StatusBar,
} from 'react-native';
import { Camera, CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GoogleDriveService } from './services/GoogleDriveService';

interface ApiKeys {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptDescription, setReceiptDescription] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    refreshToken: '',
  });

  useEffect(() => {
    (async () => {
      const mediaLibraryStatus = await MediaLibrary.requestPermissionsAsync();
      // Camera permissions are now handled by useCameraPermissions hook
      
      // Load API keys from storage
      await loadApiKeys();
    })();
  }, []);

  const loadApiKeys = async () => {
    try {
      const stored = await AsyncStorage.getItem('googleApiKeys');
      if (stored) {
        setApiKeys(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading API keys:', error);
    }
  };

  const saveApiKeys = async () => {
    try {
      await AsyncStorage.setItem('googleApiKeys', JSON.stringify(apiKeys));
      Alert.alert('Success', 'API keys saved successfully!');
      setShowSettings(false);
    } catch (error) {
      console.error('Error saving API keys:', error);
      Alert.alert('Error', 'Failed to save API keys');
    }
  };

  const takePicture = async () => {
    if (cameraRef) {
      try {
        const photo = await cameraRef.takePictureAsync({
          quality: 0.7,
          base64: false,
        });
        setCapturedPhoto(photo.uri);
        setShowCamera(false);
        setShowReceiptDialog(true);
      } catch (error) {
        console.error('Error taking picture:', error);
        Alert.alert('Error', 'Failed to take picture');
      }
    }
  };

  const saveReceipt = async () => {
    if (!capturedPhoto || !receiptDescription.trim()) {
      Alert.alert('Error', 'Please provide a description for the receipt');
      return;
    }

    // Check if API keys are configured
    if (!apiKeys.clientId || !apiKeys.clientSecret || !apiKeys.refreshToken) {
      Alert.alert('Error', 'Please configure Google Drive API keys in Settings first');
      return;
    }

    try {
      const now = new Date();
      
      // Save to media library first
      const asset = await MediaLibrary.createAssetAsync(capturedPhoto);
      
      // Upload to Google Drive
      const driveService = new GoogleDriveService(apiKeys);
      const result = await driveService.uploadReceipt(
        capturedPhoto,
        receiptDescription,
        now
      );
      
      Alert.alert(
        'Success', 
        `Receipt "${receiptDescription}" saved successfully!\n\nUploaded to: ${result.folderPath}\nGoogle Drive File ID: ${result.fileId}`
      );
      
      // Reset state
      setCapturedPhoto(null);
      setReceiptDescription('');
      setShowReceiptDialog(false);
    } catch (error) {
      console.error('Error saving receipt:', error);
      Alert.alert(
        'Error', 
        `Failed to save receipt: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text>Requesting permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.cameraButton}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ExpoStatusBar style="auto" />
      <StatusBar barStyle="dark-content" />
      
      <View style={styles.header}>
        <Text style={styles.title}>Receipt Manager</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setShowSettings(true)}
        >
          <Text style={styles.buttonText}>Settings</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.subtitle}>Capture and organize your receipts</Text>
        
        <TouchableOpacity
          style={styles.cameraButton}
          onPress={() => setShowCamera(true)}
        >
          <Text style={styles.cameraButtonText}>📷 Take Receipt Photo</Text>
        </TouchableOpacity>
      </View>

      {/* Camera Modal */}
      <Modal visible={showCamera} animationType="slide">
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            ref={setCameraRef}
          >
            <View style={styles.cameraControls}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowCamera(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.captureButton}
                onPress={takePicture}
              >
                <Text style={styles.captureButtonText}>📷</Text>
              </TouchableOpacity>
            </View>
          </CameraView>
        </View>
      </Modal>

      {/* Receipt Description Modal */}
      <Modal visible={showReceiptDialog} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>What is this receipt for?</Text>
            
            <TextInput
              style={styles.textInput}
              placeholder="e.g., Gas, Office supplies, etc."
              value={receiptDescription}
              onChangeText={setReceiptDescription}
              autoFocus
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowReceiptDialog(false);
                  setCapturedPhoto(null);
                  setReceiptDescription('');
                }}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.saveButton}
                onPress={saveReceipt}
              >
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide">
        <View style={styles.settingsContainer}>
          <ScrollView style={styles.settingsContent}>
            <Text style={styles.settingsTitle}>Google Drive API Settings</Text>
            
            <Text style={styles.label}>Client ID:</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Your Google OAuth Client ID"
              value={apiKeys.clientId}
              onChangeText={(text: string) => setApiKeys({...apiKeys, clientId: text})}
            />
            
            <Text style={styles.label}>Client Secret:</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Your Google OAuth Client Secret"
              value={apiKeys.clientSecret}
              onChangeText={(text: string) => setApiKeys({...apiKeys, clientSecret: text})}
              secureTextEntry
            />
            
            <Text style={styles.label}>Redirect URI:</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g., com.yourcompany.receiptsapp://oauth"
              value={apiKeys.redirectUri}
              onChangeText={(text: string) => setApiKeys({...apiKeys, redirectUri: text})}
            />
            
            <Text style={styles.label}>Refresh Token:</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Your Google OAuth Refresh Token"
              value={apiKeys.refreshToken}
              onChangeText={(text: string) => setApiKeys({...apiKeys, refreshToken: text})}
              secureTextEntry
            />
            
            <View style={styles.settingsButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowSettings(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.saveButton}
                onPress={saveApiKeys}
              >
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  settingsButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 40,
    textAlign: 'center',
  },
  cameraButton: {
    backgroundColor: '#34C759',
    paddingHorizontal: 40,
    paddingVertical: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  cameraButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    flex: 1,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: 20,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  captureButtonText: {
    fontSize: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    width: '80%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
  },
  saveButton: {
    backgroundColor: '#34C759',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    marginLeft: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  settingsContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  settingsContent: {
    padding: 20,
    paddingTop: 50,
  },
  settingsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  settingsButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
  },
  text: {
    fontSize: 18,
    color: '#333',
  },
});
