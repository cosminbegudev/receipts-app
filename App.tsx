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

interface ReceiptStats {
  totalReceipts: number;
  thisMonthReceipts: number;
  lastReceiptDate: string | null;
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptDescription, setReceiptDescription] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [stats, setStats] = useState<ReceiptStats>({
    totalReceipts: 0,
    thisMonthReceipts: 0,
    lastReceiptDate: null,
  });
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
      // Load statistics
      await loadStats();
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

  const loadStats = async () => {
    try {
      const stored = await AsyncStorage.getItem('receiptStats');
      if (stored) {
        setStats(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const updateStats = async () => {
    try {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      const newStats = {
        totalReceipts: stats.totalReceipts + 1,
        thisMonthReceipts: stats.lastReceiptDate && stats.lastReceiptDate.startsWith(currentMonth) 
          ? stats.thisMonthReceipts + 1 
          : 1,
        lastReceiptDate: now.toISOString(),
      };
      
      setStats(newStats);
      await AsyncStorage.setItem('receiptStats', JSON.stringify(newStats));
    } catch (error) {
      console.error('Error updating stats:', error);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning! ☀️';
    if (hour < 17) return 'Good Afternoon! ⛅';
    return 'Good Evening! 🌙';
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
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
      
      // Update statistics
      await updateStats();
      
      Alert.alert(
        'Success! 🎉', 
        `Receipt "${receiptDescription}" saved successfully!\n\nUploaded to: ${result.folderPath}\n\nYour receipts are organized and ready!`
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
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.welcomeText}>Let's organize your receipts!</Text>
        
        {/* Statistics Cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.totalReceipts}</Text>
            <Text style={styles.statLabel}>Total Receipts</Text>
          </View>
          
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{stats.thisMonthReceipts}</Text>
            <Text style={styles.statLabel}>This Month</Text>
          </View>
        </View>
        
        {/* Last Receipt Info */}
        <View style={styles.lastReceiptCard}>
          <Text style={styles.lastReceiptTitle}>📄 Last Receipt</Text>
          <Text style={styles.lastReceiptDate}>
            {stats.lastReceiptDate ? formatDate(stats.lastReceiptDate) : 'No receipts yet'}
          </Text>
        </View>
        
        {/* Action Buttons */}
        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setShowCamera(true)}
          >
            <Text style={styles.primaryButtonIcon}>📷</Text>
            <Text style={styles.primaryButtonText}>Capture Receipt</Text>
            <Text style={styles.primaryButtonSubtext}>Take a photo and organize it</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => Alert.alert('Coming Soon!', 'View receipts feature will be available in the next update.')}
          >
            <Text style={styles.secondaryButtonIcon}>📁</Text>
            <Text style={styles.secondaryButtonText}>View Receipts</Text>
          </TouchableOpacity>
        </View>
        
        {/* Quick Tips */}
        <View style={styles.tipsContainer}>
          <Text style={styles.tipsTitle}>💡 Quick Tip</Text>
          <Text style={styles.tipsText}>
            Your receipts are automatically organized by date in Google Drive (receipts/year/month)
          </Text>
        </View>
      </View>

      {/* Camera Modal */}
      <Modal visible={showCamera} animationType="slide">
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            ref={setCameraRef}
          />
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
              placeholder="urn:ietf:wg:oauth:2.0:oob"
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
    backgroundColor: '#f8f9ff',
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
    color: '#2d3748',
  },
  settingsButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 8,
  },
  welcomeText: {
    fontSize: 16,
    color: '#718096',
    marginBottom: 30,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: '#fff',
    flex: 1,
    marginHorizontal: 5,
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#667eea',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#718096',
    fontWeight: '600',
  },
  lastReceiptCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  lastReceiptTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: 4,
  },
  lastReceiptDate: {
    fontSize: 14,
    color: '#718096',
  },
  actionContainer: {
    marginBottom: 25,
  },
  primaryButton: {
    backgroundColor: '#48bb78',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryButtonIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  primaryButtonSubtext: {
    fontSize: 14,
    color: '#c6f6d5',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  secondaryButtonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4a5568',
  },
  tipsContainer: {
    backgroundColor: '#edf2f7',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#667eea',
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: 4,
  },
  tipsText: {
    fontSize: 13,
    color: '#718096',
    lineHeight: 18,
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
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
    borderRadius: 16,
    width: '80%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#2d3748',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#fff',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    backgroundColor: '#f56565',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    flex: 1,
    marginRight: 10,
  },
  saveButton: {
    backgroundColor: '#48bb78',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    flex: 1,
    marginLeft: 10,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 16,
  },
  settingsContainer: {
    flex: 1,
    backgroundColor: '#f8f9ff',
  },
  settingsContent: {
    padding: 20,
    paddingTop: 50,
  },
  settingsTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#2d3748',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#2d3748',
  },
  settingsButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
  },
  text: {
    fontSize: 18,
    color: '#2d3748',
  },
  cameraButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 20,
  },
});
