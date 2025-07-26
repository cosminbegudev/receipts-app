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
  ActivityIndicator,
  FlatList,
  Image,
  Animated,
  PanResponder,
  Dimensions,
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

interface Receipt {
  id: string;
  name: string;
  description: string;
  date: string;
  webViewLink: string;
  thumbnailLink?: string;
  imageUrl: string;
  mimeType: string;
  size: number;
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [showReceiptsList, setShowReceiptsList] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [receiptDescription, setReceiptDescription] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Image zoom and pan state
  const [imageScale] = useState(new Animated.Value(1));
  const [imageTranslateX] = useState(new Animated.Value(0));
  const [imageTranslateY] = useState(new Animated.Value(0));
  const [lastScale, setLastScale] = useState(1);
  const [lastTranslateX, setLastTranslateX] = useState(0);
  const [lastTranslateY, setLastTranslateY] = useState(0);
  const [imageLoading, setImageLoading] = useState(false);

  // Pan responder for image zoom and pan
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      imageScale.setOffset(lastScale);
      imageTranslateX.setOffset(lastTranslateX);
      imageTranslateY.setOffset(lastTranslateY);
    },
    onPanResponderMove: (evt, gestureState) => {
      const { touches } = evt.nativeEvent;
      
      if (touches.length === 2) {
        // Pinch to zoom
        const touch1 = touches[0];
        const touch2 = touches[1];
        const distance = Math.sqrt(
          Math.pow(touch2.pageX - touch1.pageX, 2) + 
          Math.pow(touch2.pageY - touch1.pageY, 2)
        );
        
        if (!panResponder.distance) {
          panResponder.distance = distance;
          return;
        }
        
        const scale = distance / panResponder.distance;
        const newScale = Math.max(0.5, Math.min(scale, 3)); // Limit zoom between 0.5x and 3x
        imageScale.setValue(newScale);
      } else if (touches.length === 1 && lastScale > 1) {
        // Pan when zoomed in
        imageTranslateX.setValue(gestureState.dx);
        imageTranslateY.setValue(gestureState.dy);
      }
    },
    onPanResponderRelease: () => {
      imageScale.flattenOffset();
      imageTranslateX.flattenOffset();
      imageTranslateY.flattenOffset();
      
      imageScale.addListener(({ value }) => setLastScale(value));
      imageTranslateX.addListener(({ value }) => setLastTranslateX(value));
      imageTranslateY.addListener(({ value }) => setLastTranslateY(value));
      
      // Reset distance for next pinch gesture
      panResponder.distance = null;
    },
  });

  // Reset image zoom when modal closes
  const resetImageZoom = () => {
    setLastScale(1);
    setLastTranslateX(0);
    setLastTranslateY(0);
    setImageLoading(false);
    imageScale.setValue(1);
    imageTranslateX.setValue(0);
    imageTranslateY.setValue(0);
    setShowImagePreview(false);
  };
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
      // Don't load receipts on startup to avoid API key race condition
      // Receipts will be loaded when needed (View Receipts button or Last Receipt card)
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

  const loadReceipts = async () => {
    if (!apiKeys.clientId || !apiKeys.clientSecret || !apiKeys.refreshToken) {
      console.log('API keys not configured, skipping receipt loading');
      return;
    }

    setLoadingReceipts(true);
    try {
      const driveService = new GoogleDriveService(apiKeys);
      const fetchedReceipts = await driveService.listReceipts();
      
      // Sort receipts by date (newest first)
      const sortedReceipts = fetchedReceipts.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      setReceipts(sortedReceipts);
    } catch (error) {
      console.error('Error loading receipts:', error);
      Alert.alert(
        'Error', 
        `Failed to load receipts: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoadingReceipts(false);
    }
  };

  const loadReceiptsWithValidation = async () => {
    if (!apiKeys.clientId || !apiKeys.clientSecret || !apiKeys.refreshToken) {
      Alert.alert('Error', 'Please configure Google Drive API keys in Settings first');
      return;
    }
    await loadReceipts();
  };

  const openReceipt = (receipt: Receipt) => {
    setSelectedReceipt(receipt);
    setShowImagePreview(true);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const groupReceiptsByMonth = (receipts: Receipt[]) => {
    const grouped: { [key: string]: Receipt[] } = {};
    
    receipts.forEach(receipt => {
      const date = new Date(receipt.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
      
      if (!grouped[monthName]) {
        grouped[monthName] = [];
      }
      grouped[monthName].push(receipt);
    });
    
    return grouped;
  };

  const filterReceipts = (receipts: Receipt[], query: string): Receipt[] => {
    if (!query.trim()) {
      return receipts;
    }
    
    const lowercaseQuery = query.toLowerCase();
    return receipts.filter(receipt => 
      receipt.description.toLowerCase().includes(lowercaseQuery) ||
      receipt.name.toLowerCase().includes(lowercaseQuery)
    );
  };

  const filteredReceipts = filterReceipts(receipts, searchQuery);

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
        <ScrollView 
          style={styles.scrollContainer} 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
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
          <TouchableOpacity 
            style={styles.lastReceiptCard}
            onPress={async () => {
              if (receipts.length === 0) {
                // Load receipts first if not loaded
                await loadReceipts();
              }
              if (receipts.length > 0) {
                // Show the most recent receipt
                openReceipt(receipts[0]);
              } else {
                Alert.alert('No Receipts', 'No receipts found. Capture your first receipt to get started!');
              }
            }}
          >
            <Text style={styles.lastReceiptTitle}>📄 Last Receipt</Text>
            <Text style={styles.lastReceiptDate}>
              {stats.lastReceiptDate ? formatDate(stats.lastReceiptDate) : 'No receipts yet'}
            </Text>
            {receipts.length > 0 && (
              <Text style={styles.lastReceiptDesc}>
                {receipts[0].description}
              </Text>
            )}
            <Text style={styles.lastReceiptHint}>Tap to view</Text>
          </TouchableOpacity>
          
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
              onPress={() => {
                setShowReceiptsList(true);
                loadReceiptsWithValidation();
              }}
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
        </ScrollView>
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

      {/* View Receipts Modal */}
      <Modal visible={showReceiptsList} animationType="slide">
        <View style={styles.settingsContainer}>
          <View style={styles.receiptsHeader}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setShowReceiptsList(false);
                setSearchQuery(''); // Clear search when closing
              }}
            >
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.receiptsTitle}>Your Receipts</Text>
            <View style={styles.placeholderButton} />
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search receipts by name or description..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                style={styles.clearSearchButton}
                onPress={() => setSearchQuery('')}
              >
                <Text style={styles.clearSearchText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {loadingReceipts ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#667eea" />
              <Text style={styles.loadingText}>Loading receipts...</Text>
            </View>
          ) : receipts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📄</Text>
              <Text style={styles.emptyTitle}>No Receipts Yet</Text>
              <Text style={styles.emptyText}>
                Start capturing receipts to see them organized here by date.
              </Text>
            </View>
          ) : filteredReceipts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No Results Found</Text>
              <Text style={styles.emptyText}>
                No receipts match "{searchQuery}". Try a different search term.
              </Text>
            </View>
          ) : (
            <>
              {/* Search Results Counter */}
              {searchQuery.length > 0 && (
                <View style={styles.searchResultsContainer}>
                  <Text style={styles.searchResultsText}>
                    Found {filteredReceipts.length} receipt{filteredReceipts.length !== 1 ? 's' : ''} matching "{searchQuery}"
                  </Text>
                </View>
              )}
              
              <FlatList
                style={styles.receiptsList}
                data={Object.entries(groupReceiptsByMonth(filteredReceipts))}
                keyExtractor={([month]) => month}
                renderItem={({ item: [month, monthReceipts] }) => (
                  <View style={styles.monthSection}>
                    <Text style={styles.monthTitle}>{month}</Text>
                    {monthReceipts.map((receipt) => (
                      <TouchableOpacity
                        key={receipt.id}
                        style={styles.receiptItem}
                        onPress={() => openReceipt(receipt)}
                      >
                        <View style={styles.receiptIcon}>
                          <Text style={styles.receiptIconText}>📄</Text>
                        </View>
                        <View style={styles.receiptInfo}>
                          <Text style={styles.receiptDescription} numberOfLines={1}>
                            {receipt.description}
                          </Text>
                          <Text style={styles.receiptDate}>
                            {formatDate(receipt.date)} • {formatFileSize(receipt.size)}
                          </Text>
                        </View>
                        <Text style={styles.receiptArrow}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              />
            </>
          )}
        </View>
      </Modal>

      {/* Image Preview Modal */}
      <Modal visible={showImagePreview} animationType="fade" transparent>
        <View style={styles.imagePreviewOverlay}>
          <View style={styles.imagePreviewContainer}>
            <View style={styles.imagePreviewHeader}>
              <TouchableOpacity
                style={styles.closeImageButton}
                onPress={resetImageZoom}
              >
                <Text style={styles.closeImageButtonText}>✕</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resetZoomButton}
                onPress={() => {
                  setLastScale(1);
                  setLastTranslateX(0);
                  setLastTranslateY(0);
                  Animated.parallel([
                    Animated.spring(imageScale, { toValue: 1, useNativeDriver: true }),
                    Animated.spring(imageTranslateX, { toValue: 0, useNativeDriver: true }),
                    Animated.spring(imageTranslateY, { toValue: 0, useNativeDriver: true }),
                  ]).start();
                }}
              >
                <Text style={styles.resetZoomButtonText}>Reset</Text>
              </TouchableOpacity>
            </View>
            
            {selectedReceipt && (
              <>
                <View style={styles.imageContainer} {...panResponder.panHandlers}>
                  {imageLoading && (
                    <View style={styles.imageLoadingOverlay}>
                      <ActivityIndicator size="large" color="#fff" />
                      <Text style={styles.imageLoadingText}>Loading high-quality image...</Text>
                    </View>
                  )}
                  <Animated.Image
                    source={{ 
                      uri: selectedReceipt.imageUrl,
                      cache: 'force-cache', // Enable caching for better performance
                    }}
                    style={[
                      styles.receiptImage,
                      {
                        transform: [
                          { scale: imageScale },
                          { translateX: imageTranslateX },
                          { translateY: imageTranslateY },
                        ],
                      },
                    ]}
                    resizeMode="contain"
                    onError={(error) => {
                      console.error('Image load error details:', {
                        selectedReceiptId: selectedReceipt?.id,
                        imageUrl: selectedReceipt?.imageUrl,
                        errorMessage: error.nativeEvent?.error || 'Unknown error'
                      });
                      setImageLoading(false);
                      Alert.alert(
                        'Image Load Error', 
                        `Failed to load receipt image.\n\nURL: ${selectedReceipt?.imageUrl?.substring(0, 60)}...\n\nError: ${error.nativeEvent?.error || 'Unknown error'}\n\nPlease try again or check your internet connection.`,
                        [{ text: 'OK' }]
                      );
                    }}
                    onLoadStart={() => {
                      console.log('Started loading high-quality image');
                      setImageLoading(true);
                    }}
                    onLoad={() => {
                      console.log('High-quality image loaded successfully');
                      setImageLoading(false);
                    }}
                  />
                </View>
                
                <View style={styles.imagePreviewInfo}>
                  <Text style={styles.imagePreviewTitle}>{selectedReceipt.description}</Text>
                  <Text style={styles.imagePreviewDate}>
                    {formatDate(selectedReceipt.date)} • {formatFileSize(selectedReceipt.size)}
                  </Text>
                  
                  <Text style={styles.zoomHint}>
                    💡 Pinch to zoom • Drag to pan • Tap reset to restore
                  </Text>
                  
                  <TouchableOpacity
                    style={styles.viewInDriveButton}
                    onPress={() => {
                      Alert.alert(
                        'Open in Google Drive',
                        'This would open the receipt in Google Drive app or browser.',
                        [{ text: 'OK' }]
                      );
                    }}
                  >
                    <Text style={styles.viewInDriveButtonText}>View in Google Drive</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
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
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40, // Extra padding at bottom to ensure content is fully visible
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
  lastReceiptDesc: {
    fontSize: 14,
    color: '#4a5568',
    marginTop: 4,
    fontWeight: '500',
  },
  lastReceiptHint: {
    fontSize: 12,
    color: '#a0aec0',
    marginTop: 8,
    fontStyle: 'italic',
  },
  actionContainer: {
    marginBottom: 20, // Reduced from 25 to 20
  },
  primaryButton: {
    backgroundColor: '#48bb78',
    padding: 20, // Reduced from 24 to 20
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
  receiptsHeader: {
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
  backButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  receiptsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2d3748',
  },
  placeholderButton: {
    width: 70, // Same width as back button for centering
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#f8f9ff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  clearSearchButton: {
    position: 'absolute',
    right: 30,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#cbd5e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearSearchText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  searchResultsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#edf2f7',
  },
  searchResultsText: {
    fontSize: 14,
    color: '#718096',
    fontStyle: 'italic',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#718096',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#718096',
    textAlign: 'center',
    lineHeight: 24,
  },
  receiptsList: {
    flex: 1,
    padding: 20,
  },
  monthSection: {
    marginBottom: 30,
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 16,
    paddingLeft: 4,
  },
  receiptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  receiptIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f4ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  receiptIconText: {
    fontSize: 20,
  },
  receiptInfo: {
    flex: 1,
  },
  receiptDescription: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: 4,
  },
  receiptDate: {
    fontSize: 14,
    color: '#718096',
  },
  receiptArrow: {
    fontSize: 20,
    color: '#cbd5e0',
    marginLeft: 8,
  },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  imagePreviewHeader: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  closeImageButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeImageButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  resetZoomButton: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resetZoomButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    position: 'relative',
  },
  imageLoadingOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -75 }, { translateY: -40 }],
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    zIndex: 10,
  },
  imageLoadingText: {
    color: '#fff',
    marginTop: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  receiptImage: {
    width: '100%',
    height: '80%',
    borderRadius: 8,
  },
  imagePreviewInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 20,
    paddingBottom: 40,
  },
  imagePreviewTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  imagePreviewDate: {
    color: '#cbd5e0',
    fontSize: 16,
    marginBottom: 8,
  },
  zoomHint: {
    color: '#a0aec0',
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 16,
    textAlign: 'center',
  },
  viewInDriveButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  viewInDriveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
