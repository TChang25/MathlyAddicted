import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SafeAreaView, StyleSheet, Text, View, TouchableOpacity, Alert, BackHandler, Animated, Dimensions, StatusBar, Switch, Platform, TextInput, ScrollView, KeyboardAvoidingView } from 'react-native';
import { Provider as PaperProvider, Appbar, useTheme } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MultiplayerService from './MultiplayerService';
import { containsProfanity } from './ProfanityFilter';
import { Audio } from 'expo-av';
import mobileAds, { BannerAd, BannerAdSize, TestIds, InterstitialAd, AdEventType, MaxAdContentRating } from 'react-native-google-mobile-ads';
import { useIAP, ErrorCode, isUserCancelledError } from 'expo-iap';
import Constants from 'expo-constants';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('screen');
const BORDER_WIDTH = 15;
const CORNER_RADIUS = 50; 
const INNER_RADIUS = CORNER_RADIUS - BORDER_WIDTH;

const operations = ['+', '-', '*', '/', '^2', 'root'];

const IAP_PRODUCT_ID = Platform.select({
  ios: 'com.mathlyaddicted.removeads',
  android: 'com.mathlyaddicted.removeads',
});

const adUnitIdBanner = __DEV__
  ? TestIds.BANNER
  : Platform.select({
      ios: 'ca-app-pub-6440220869221286/7486332956',
      android: 'ca-app-pub-6440220869221286/2980983878',
    });

const adUnitIdInterstitial = __DEV__
  ? TestIds.INTERSTITIAL
  : Platform.select({
      ios: 'ca-app-pub-6440220869221286/4828380029',
      android: 'ca-app-pub-6440220869221286/9278760927',
    });

// Simple seeded random number generator (Lcg)
const createSeededRNG = (seed) => {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
};

const KID_FONT = Platform.OS === 'ios' ? 'Chalkboard SE' : 'sans-serif-medium';
const SYSTEM_FONT = Platform.OS === 'ios' ? 'System' : 'sans-serif';

const DriftingOperator = ({ char, size, opacity, rotation, color = '#000' }) => {
  const moveAnim = useRef(new Animated.ValueXY({
    x: Math.random() * (SCREEN_WIDTH - size),
    y: Math.random() * (SCREEN_HEIGHT - size)
  })).current;

  useEffect(() => {
    let isMounted = true;
    const move = () => {
      if (!isMounted) return;
      Animated.timing(moveAnim, {
        toValue: {
          x: Math.random() * (SCREEN_WIDTH - size),
          y: Math.random() * (SCREEN_HEIGHT - size)
        },
        duration: 15000 + Math.random() * 10000,
        useNativeDriver: true,
      }).start(() => {
        if (isMounted) move();
      });
    };
    move();
    return () => {
      isMounted = false;
      moveAnim.stopAnimation();
    };
  }, [size]);

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        fontSize: size,
        opacity: opacity,
        transform: [
          { translateX: moveAnim.x },
          { translateY: moveAnim.y },
          { rotate: rotation }
        ],
        color: color,
        fontWeight: 'bold',
      }}
    >
      {char}
    </Animated.Text>
  );
};

const MathBackground = ({ operatorColor = '#000', count = 20 }) => {
  const allOperators = useMemo(() => {
    const ops = ['+', '-', '×', '÷', '=', '√', 'π', '%', '^²'];
    return Array.from({ length: 30 }).map((_, i) => ({
      id: i,
      char: ops[Math.floor(Math.random() * ops.length)],
      size: Math.random() * 20 + 20,
      opacity: Math.random() * 0.13 + 0.065, // Increased by exactly 30% from the original 0.05-0.15 range
      rotation: Math.random() * 360 + 'deg',
    }));
  }, []);

  const visibleOperators = useMemo(() => {
    return allOperators.slice(0, Math.min(count, 30));
  }, [allOperators, count]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {visibleOperators.map((op) => (
        <DriftingOperator key={op.id} {...op} color={operatorColor} />
      ))}
    </View>
  );
};

const generateQuestion = (selectedOperations, maxNum = 10, allowZero = false, allowNegative = false, minNum = 1, rng = Math.random) => {
  const getRand = () => {
    let low = minNum;
    let high = maxNum;

    // Strict Enforcement of Negatives
    if (!allowNegative) {
      low = Math.max(0, low);
    }

    // Strict Enforcement of Zero
    // We collect all valid numbers in the requested range
    let pool = [];
    for (let i = low; i <= high; i++) {
      if (!allowZero && i === 0) continue;
      if (!allowNegative && i < 0) continue;
      pool.push(i);
    }

    // Fallback if pool is empty due to restrictive settings
    if (pool.length === 0) {
      return allowZero ? 0 : 1;
    }

    return pool[Math.floor(rng() * pool.length)];
  };

  const num1 = getRand();
  const num2 = getRand();
  const op = selectedOperations[Math.floor(rng() * selectedOperations.length)];

  let question = '';
  let answer = 0;

  switch (op) {
    case '+':
      question = `${num1} + ${num2}`;
      answer = num1 + num2;
      break;
    case '-':
      question = `${num1 + num2} - ${num1}`;
      answer = num2;
      break;
    case '*':
      question = `${num1} * ${num2}`;
      answer = num1 * num2;
      break;
    case '/':
      // Ensure no division by zero
      const divisor = num1 === 0 ? 1 : num1;
      const quotient = num2;
      question = `${divisor * quotient} / ${divisor}`;
      answer = quotient;
      break;
    case '^2':
      question = `${num1}²`;
      answer = num1 * num1;
      break;
    case 'root':
      // Ensure we don't have root of a negative if settings changed mid-game
      const r = Math.abs(num1);
      question = `√${r * r}`;
      answer = r;
      break;
  }
  return { question, answer };
};

const CollapsingCircleTimer = ({ timerAnim, combo }) => {
  const circleSize = SCREEN_WIDTH * 0.92; // Increased by 15% (0.8 * 1.15 = 0.92)
  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]} pointerEvents="none">
      <Animated.View
        style={{
          width: timerAnim.interpolate({
            inputRange: [0, 5],
            outputRange: [0, circleSize],
          }),
          height: timerAnim.interpolate({
            inputRange: [0, 5],
            outputRange: [0, circleSize],
          }),
          borderRadius: circleSize / 2,
          backgroundColor: 'rgba(0, 123, 255, 0.1)',
        }}
      />
      {combo > 0 && (
        <Text style={{
          position: 'absolute',
          fontSize: 80,
          fontWeight: 'bold',
          color: 'rgba(0, 123, 255, 0.3)',
          fontFamily: KID_FONT
        }}>
          {combo}
        </Text>
      )}
    </View>
  );
};

const BorderProgressBar = ({ combo, colorAnim, progressAnim }) => {
  const getBorderColor = () => {
    if (combo > 20) {
      return colorAnim.interpolate({
        inputRange: [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1],
        outputRange: [
          'hsl(0, 40%, 75%)',
          'hsl(60, 40%, 75%)',
          'hsl(120, 40%, 75%)',
          'hsl(180, 40%, 75%)',
          'hsl(240, 40%, 75%)',
          'hsl(300, 40%, 75%)',
          'hsl(360, 40%, 75%)',
        ],
      });
    }
    if (combo > 10) return '#C23B22';
    if (combo > 7) return '#967BB6';
    if (combo > 3) return '#E1A95F';
    if (combo > 0) return '#779ECB';
    return 'transparent';
  };

  const color = getBorderColor();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{ flex: 1, borderRadius: 0, overflow: 'hidden' }}>
        <Animated.View style={[styles.borderBar, {
          top: 0, left: 0, height: BORDER_WIDTH * 2,
          backgroundColor: color,
          width: progressAnim.interpolate({
            inputRange: [0, 0.25, 1],
            outputRange: ['0%', '100%', '100%']
          }),
        }]} />
        <Animated.View style={[styles.borderBar, {
          top: 0, right: 0, width: BORDER_WIDTH * 2,
          backgroundColor: color,
          height: progressAnim.interpolate({
            inputRange: [0, 0.25, 0.5, 1],
            outputRange: ['0%', '0%', '100%', '100%']
          }),
        }]} />
        <Animated.View style={[styles.borderBar, {
          bottom: 0, right: 0, height: BORDER_WIDTH * 2,
          backgroundColor: color,
          width: progressAnim.interpolate({
            inputRange: [0, 0.5, 0.75, 1],
            outputRange: ['0%', '0%', '100%', '100%']
          }),
        }]} />
        <Animated.View style={[styles.borderBar, {
          bottom: 0, left: 0, width: BORDER_WIDTH * 2,
          backgroundColor: color,
          height: progressAnim.interpolate({
            inputRange: [0, 0.75, 1],
            outputRange: ['0%', '0%', '100%']
          }),
        }]} />
        <View style={{
          position: 'absolute',
          top: BORDER_WIDTH,
          left: BORDER_WIDTH,
          right: BORDER_WIDTH,
          bottom: BORDER_WIDTH,
          backgroundColor: '#f0f0f0',
          borderRadius: INNER_RADIUS,
        }} />
      </View>
    </View>
  );
};

const MainGame = ({
  startNewQuestion,
  score,
  highScore,
  timer,
  question,
  handleAnswer,
  answer,
  combo,
  strikes,
  navigation,
  flashAnim,
  countdown,
  isCountingDown,
  lastPoints,
  pointsFadeAnim,
  isZenMode,
  timerAnim,
  isSafetyMode,
  currentOptions,
}) => {
  const colorAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const isRainbowActive = useRef(false);

  useEffect(() => {
    Animated.spring(progressAnim, {
      toValue: Math.min(combo / 21, 1),
      useNativeDriver: false,
    }).start();

    if (combo > 20 && !isSafetyMode) {
      if (!isRainbowActive.current) {
        isRainbowActive.current = true;
        Animated.loop(
          Animated.timing(colorAnim, {
            toValue: 1,
            duration: 5000,
            useNativeDriver: false,
          })
        ).start();
      }
    } else {
      isRainbowActive.current = false;
      colorAnim.stopAnimation();
      colorAnim.setValue(0);
    }
  }, [combo, isSafetyMode]);

    const handleExit = () => {
    Alert.alert("Exit Game", "Do you want to save your progress and exit, or quit without saving?", [
      { text: "Cancel", style: "cancel" },
      { text: "Quit (No Save)", onPress: () => { navigation.resetGame(); navigation.navigate("Menu"); }, style: 'destructive' },
      { text: "Save & Exit", onPress: () => { navigation.saveAndExit(); } },
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <BorderProgressBar combo={combo} colorAnim={colorAnim} progressAnim={progressAnim} />
      <View style={[StyleSheet.absoluteFill, { padding: BORDER_WIDTH }]} pointerEvents="box-none">
        <View style={{ flex: 1, borderRadius: INNER_RADIUS, backgroundColor: '#f0f0f0', overflow: 'hidden' }}>
          <MathBackground count={Math.min(combo, 30)} />
          <Appbar.Header style={{ width: '100%', backgroundColor: 'transparent' }}>
            <Appbar.Content title="" />
            <View style={styles.highScoreContainer}>
              <Text style={styles.highScoreText}>Best: {highScore}</Text>
            </View>
            <Appbar.Action icon="exit-to-app" onPress={handleExit} />
          </Appbar.Header>
          {!isZenMode && <CollapsingCircleTimer timerAnim={timerAnim} combo={combo} />}
          <View style={styles.gameBody}>
            <View style={styles.statsContainer}>
              {!isZenMode && (
                <View style={styles.strikesContainer}>
                  <Text style={styles.strikesLabel}>Strikes: </Text>
                  {[1, 2, 3].map((s) => (
                    <Text key={s} style={[styles.strikeIcon, { color: s <= strikes ? 'red' : 'gray' }]}>X</Text>
                  ))}
                </View>
              )}
              <Text style={styles.score}>Score: {score}</Text>
            </View>
            <View style={{ alignItems: 'center', height: 40, justifyContent: 'center' }}>
              {lastPoints && (
                <Animated.Text style={[styles.pointsPopup, { opacity: pointsFadeAnim }]}>
                  +{lastPoints}
                </Animated.Text>
              )}
            </View>
            <Text style={styles.question}>{question} = ?</Text>
            <View style={styles.answerOptions}>
              {currentOptions.map((option, index) => (
                <TouchableOpacity key={index} style={styles.answerButton} onPress={() => handleAnswer(option)}>
                  <Text style={styles.answerButtonText}>{option}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!isZenMode && <Text style={styles.timer}>Time Remaining: {timer}</Text>}
          </View>
        </View>
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: 'red',
            opacity: flashAnim,
            zIndex: 20000,
          },
        ]}
      />
      {isCountingDown && (
        <View style={styles.countdownOverlay}>
          <Text style={styles.countdownText}>{countdown}</Text>
        </View>
      )}
    </View>
  );
};

const GameModes = ({ 
  navigation, 
  setOperations, 
  isZenMode, 
  setIsZenMode, 
  savedGames, 
  loadSavedGame,
  minNumber,
  setMinNumber,
  maxNumber,
  setMaxNumber,
  allowZero,
  setAllowZero,
  allowNegative,
  setAllowNegative
}) => {
  const [activeTab, setActiveTab] = useState('Modes');

  const handleModeSelection = (mode) => {
    const ops = [...mode.op].sort().join('');
    const specificSaveKey = `saved_game_${ops}_${isZenMode ? 'zen' : 'normal'}`;
    
    if (savedGames[specificSaveKey]) {
      Alert.alert(
        "Saved Game Found",
        `You have a saved game for this mode (${mode.label}). Would you like to continue or start a new game?`,
        [
          {
            text: "New Game",
            onPress: async () => {
              await AsyncStorage.removeItem(specificSaveKey);
              setOperations(mode.op);
              navigation.resetGame();
              navigation.navigate("Game");
            },
            style: "destructive"
          },
          {
            text: "Continue",
            onPress: () => {
              loadSavedGame(specificSaveKey);
            }
          },
          { text: "Cancel", style: "cancel" }
        ]
      );
    } else {
      setOperations(mode.op);
      navigation.resetGame(); 
      navigation.navigate("Game");
    }
  };

  return (
    <View style={styles.container}>
      <MathBackground />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <Appbar.Content title="Operation Selection!" titleStyle={{ fontFamily: KID_FONT, color: '#333' }} />
      </Appbar.Header>

      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'Modes' && styles.activeTab]} 
          onPress={() => setActiveTab('Modes')}
        >
          <Text style={[styles.tabText, activeTab === 'Modes' && styles.activeTabText]}>Modes</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'Settings' && styles.activeTab]} 
          onPress={() => setActiveTab('Settings')}
        >
          <Text style={[styles.tabText, activeTab === 'Settings' && styles.activeTabText]}>Settings</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.gameBody}>
          {activeTab === 'Settings' ? (
            <View style={{ width: '100%', alignItems: 'center', marginTop: 20 }}>
              <Text style={styles.sectionHeader}>Game Settings</Text>
              
              <View style={styles.zenModeContainer}>
                <Text style={styles.zenModeText}>Zen Mode (No Timer/Strikes)</Text>
                <Switch
                  value={isZenMode}
                  onValueChange={setIsZenMode}
                  color="#007bff"
                />
              </View>

              <View style={{ flexDirection: 'row', width: '85%', justifyContent: 'space-between' }}>
                <View style={[styles.zenModeContainer, { width: '48%', minHeight: 120, flexDirection: 'column', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' }]}>
                  <Text style={[styles.zenModeText, { fontSize: 14, color: '#666' }]}>Min Number</Text>
                  <TextInput
                    style={[styles.nicknameInput, { width: '100%', textAlign: 'center', marginTop: 8 }]}
                    placeholder="Min"
                    placeholderTextColor="#999"
                    value={String(minNumber)}
                    onChangeText={(val) => {
                      const num = parseInt(val);
                      setMinNumber(isNaN(num) ? 0 : num);
                    }}
                    keyboardType="numeric"
                    maxLength={5}
                  />
                </View>
                <View style={[styles.zenModeContainer, { width: '48%', minHeight: 120, flexDirection: 'column', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' }]}>
                  <Text style={[styles.zenModeText, { fontSize: 14, color: '#666' }]}>Max Number</Text>
                  <TextInput
                    style={[styles.nicknameInput, { width: '100%', textAlign: 'center', marginTop: 8 }]}
                    placeholder="Max"
                    placeholderTextColor="#999"
                    value={String(maxNumber)}
                    onChangeText={(val) => {
                      const num = parseInt(val);
                      setMaxNumber(isNaN(num) ? 0 : num);
                    }}
                    keyboardType="numeric"
                    maxLength={5}
                  />
                </View>
              </View>

              <View style={styles.zenModeContainer}>
                <Text style={styles.zenModeText}>Allow Zero</Text>
                <Switch
                  value={allowZero}
                  onValueChange={setAllowZero}
                  color="#007bff"
                />
              </View>

              <View style={styles.zenModeContainer}>
                <Text style={styles.zenModeText}>Allow Negative</Text>
                <Switch
                  value={allowNegative}
                  onValueChange={setAllowNegative}
                  color="#007bff"
                />
              </View>
            </View>
          ) : (
            <View style={{ width: '100%', alignItems: 'center', marginTop: 20 }}>
              <Text style={styles.sectionHeader}>Select Operation Mode</Text>
              {[
                { label: 'Addition', op: ['+'], icon: '+', color: '#4CAF50' },
                { label: 'Subtraction', op: ['-'], icon: '-', color: '#F44336' },
                { label: 'Division', op: ['/'], icon: '÷', color: '#2196F3' },
                { label: 'Multiplication', op: ['*'], icon: '×', color: '#FF9800' },
                { label: 'Squaring', op: ['^2'], icon: 'x²', color: '#795548' },
                { label: 'Square Roots', op: ['root'], icon: '√', color: '#607D8B' },
                { label: 'All Operations!', op: ['+', '-', '*', '/', '^2', 'root'], icon: '🧠', color: '#9C27B0' },
              ].map((mode, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.menuButton}
                  onPress={() => handleModeSelection(mode)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 10 }}>
                    <View style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: '#fff',
                      justifyContent: 'center',
                      alignItems: 'center',
                      elevation: 3,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.2,
                      shadowRadius: 1,
                      overflow: 'hidden',
                    }}>
                      <Text style={[styles.menuButtonText, { color: mode.color, fontSize: 32, fontWeight: '900', fontFamily: mode.icon === '🧠' ? KID_FONT : SYSTEM_FONT, textAlign: 'center', includeFontPadding: false, textAlignVertical: 'center', lineHeight: Platform.OS === 'ios' ? 40 : undefined }]}>{mode.icon}</Text>
                    </View>
                    <Text style={styles.menuButtonText}>{mode.label}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.divider} />
          <TouchableOpacity
            style={[styles.menuButton, { marginTop: 10, backgroundColor: 'grey' }]}
            onPress={() => navigation.navigate("Menu")}
          >
            <Text style={styles.menuButtonText}>Back to Menu</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const Leaderboard = ({ navigation, adsRemoved }) => {
  const [tab, setTab] = useState('Normal');
  const [selectedMode, setSelectedMode] = useState(null);
  const [highScores, setHighScores] = useState({});

  useEffect(() => {
    const loadAllHighScores = async () => {
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const scoreKeys = allKeys.filter(key => key.startsWith('leaderboard_'));
        const pairs = await AsyncStorage.multiGet(scoreKeys);
        const scoresMap = {};
        pairs.forEach(([key, value]) => {
          scoresMap[key] = JSON.parse(value);
        });
        setHighScores(scoresMap);
      } catch (e) {
        console.error("Failed to load scores for leaderboard", e);
      }
    };
    loadAllHighScores();
  }, []);

  const modes = [
    { label: 'Addition', op: '+' },
    { label: 'Subtraction', op: '-' },
    { label: 'Division', op: '/' },
    { label: 'Multiplication', op: '*' },
    { label: 'Squaring', op: '^2' },
    { label: 'Square Roots', op: 'root' },
    { label: 'All Operations!', op: '*-+/^2root' }, // Correct ASCII sorted order
  ];

  const renderModes = () => {
    const suffix = tab === 'Normal' ? 'normal' : 'zen';
    return modes.map((mode, index) => {
      const key = `leaderboard_${mode.op}_${suffix}`;
      const scores = highScores[key] || [];
      const topScore = scores.length > 0 ? scores[0].score : 0;
      return (
        <TouchableOpacity 
          key={index} 
          style={styles.leaderboardRow}
          onPress={() => setSelectedMode(mode)}
        >
          <Text style={styles.leaderboardLabel}>{mode.label}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.leaderboardValue}>{topScore}</Text>
            <Text style={{ marginLeft: 10, color: '#666' }}>{'>'}</Text>
          </View>
        </TouchableOpacity>
      );
    });
  };

  const renderTop10 = () => {
    const suffix = tab === 'Normal' ? 'normal' : 'zen';
    const key = `leaderboard_${selectedMode.op}_${suffix}`;
    const scores = highScores[key] || [];

    return (
      <View style={{ width: '100%', flex: 1 }}>
        <TouchableOpacity 
          style={{ padding: 10, marginBottom: 10 }} 
          onPress={() => setSelectedMode(null)}
        >
          <Text style={{ color: '#007bff', fontWeight: 'bold' }}>← Back to Modes</Text>
        </TouchableOpacity>
        <Text style={[styles.sectionHeader, { marginLeft: 0, marginBottom: 15 }]}>
          Top 10 - {selectedMode.label} ({tab})
        </Text>
        {scores.length === 0 ? (
          <Text style={{ textAlign: 'center', marginTop: 20, color: '#666' }}>No scores yet!</Text>
        ) : (
          scores.map((item, index) => (
            <View key={index} style={styles.scoreDetailRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.rankText}>{index + 1}.</Text>
                  <Text style={styles.nameText}>{item.name}</Text>
                </View>
                <Text style={styles.dateText}>{item.date || 'Unknown Date'}</Text>
              </View>
              <Text style={styles.scoreText}>{item.score}</Text>
            </View>
          ))
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <MathBackground />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <View style={{ marginLeft: '10%', flexDirection: 'row', alignItems: 'center' }}>
          <Appbar.BackAction size={32} onPress={() => selectedMode ? setSelectedMode(null) : navigation.navigate("Menu")} />
        </View>
        <Appbar.Content title="Leaderboard" titleStyle={{ fontFamily: KID_FONT, color: '#333' }} />
      </Appbar.Header>
      {!selectedMode && (
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tabButton, tab === 'Normal' && styles.activeTab]} 
            onPress={() => setTab('Normal')}
          >
            <Text style={[styles.tabText, tab === 'Normal' && styles.activeTabText]}>Normal</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tabButton, tab === 'Zen' && styles.activeTab]} 
            onPress={() => setTab('Zen')}
          >
            <Text style={[styles.tabText, tab === 'Zen' && styles.activeTabText]}>Zen</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.leaderboardBody}>
        {selectedMode ? renderTop10() : renderModes()}
        {!selectedMode && (
          <TouchableOpacity
            style={[styles.menuButton, { marginTop: 40 }]}
            onPress={() => navigation.navigate("Menu")}
          >
            <Text style={styles.menuButtonText}>Back to Menu</Text>
          </TouchableOpacity>
        )}
      </View>
      {!adsRemoved && (
        <View style={{ alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <BannerAd
            unitId={adUnitIdBanner}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        </View>
      )}
    </View>
  );
};

const MultiplayerMenu = ({ navigation, setNickname, nickname }) => {
  const [roomCodeInput, setRoomCodeInput] = useState('');

  const handleCreateRoom = async () => {
    if (!nickname.trim()) {
      Alert.alert("Error", "Please enter a nickname first!");
      return;
    }
    if (containsProfanity(nickname)) {
      Alert.alert("Error", "Please choose a different nickname.");
      return;
    }
    const code = MultiplayerService.generateRoomCode();
    navigation.setRoomState({ roomCode: code, isHost: true });
    try {
      const hostId = await MultiplayerService.createRoom(code, nickname, { operations: ['+'], maxNumber: 10, minNumber: 1 });
      navigation.setPlayerId(hostId);
      navigation.navigate("MultiplayerLobby");
    } catch (e) {
      Alert.alert("Error", "Failed to create room: " + e.message);
    }
  };

  const handleJoinRoom = async () => {
    if (!nickname.trim()) {
      Alert.alert("Error", "Please enter a nickname first!");
      return;
    }
    if (containsProfanity(nickname)) {
      Alert.alert("Error", "Please choose a different nickname.");
      return;
    }
    if (roomCodeInput.length < 8) {
      Alert.alert("Error", "Room code must be at least 8 characters!");
      return;
    }
    try {
      const playerId = await MultiplayerService.joinRoom(roomCodeInput.toUpperCase(), nickname);
      navigation.setRoomState({ roomCode: roomCodeInput.toUpperCase(), isHost: false });
      navigation.setPlayerId(playerId);
      navigation.navigate("MultiplayerLobby");
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <MathBackground />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <View style={{ marginLeft: '10%', flexDirection: 'row', alignItems: 'center' }}>
          <Appbar.BackAction size={32} onPress={() => navigation.navigate("Menu")} />
        </View>
        <Appbar.Content title="Multiplayer" titleStyle={{ fontFamily: KID_FONT, color: '#333' }} />
      </Appbar.Header>
      <ScrollView 
        contentContainerStyle={[styles.gameBody, { paddingBottom: 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.zenModeContainer}>
          <TextInput
            style={[styles.nicknameInput, { flex: 1 }]}
            placeholder="Enter Nickname (Max 12)"
            value={nickname}
            onChangeText={(text) => setNickname(text.substring(0, 12))}
            maxLength={12}
          />
        </View>

        <TouchableOpacity style={styles.menuButton} onPress={handleCreateRoom}>
          <Text style={styles.menuButtonText}>CREATE ROOM</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.zenModeContainer}>
          <TextInput
            style={[styles.nicknameInput, { flex: 1 }]}
            placeholder="Enter 8-Char Room Code"
            value={roomCodeInput}
            onChangeText={(text) => setRoomCodeInput(text.toUpperCase())}
            maxLength={12}
          />
        </View>
        <TouchableOpacity style={styles.menuButton} onPress={handleJoinRoom}>
          <Text style={styles.menuButtonText}>JOIN ROOM</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuButton, { marginTop: 40, backgroundColor: 'grey' }]}
          onPress={() => navigation.navigate("Menu")}
        >
          <Text style={styles.menuButtonText}>Back to Menu</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const MultiplayerTimer = ({ onExpire, currentScore, roomCode, playerId, isHost, players, setRank }) => {
  const [timeLeft, setTimeLeft] = useState(60);
  const hasExpired = useRef(false);
  const latestScore = useRef(currentScore);

  useEffect(() => {
    latestScore.current = currentScore;
  }, [currentScore]);

  const checkRank = async (currentLeft) => {
    // Only check every 10 seconds (50, 40, 30, 20, 10)
    if (currentLeft > 0 && currentLeft < 60 && currentLeft % 10 === 0) {
      // 1. Sync score
      MultiplayerService.syncPlayerScore(roomCode, playerId, latestScore.current);

      // 2. Determine ranking
      const playerList = Object.values(players);
      if (playerList.length > 0) {
        const sortedPlayers = [...playerList].sort((a, b) => b.score - a.score);
        const myRank = sortedPlayers.findIndex(p => p.score <= latestScore.current) + 1;
        setRank(myRank);
      }
    }
  };

  // Wait for all players to finish before host calls finishGame
  useEffect(() => {
    if (isHost && hasExpired.current) {
      const allFinished = Object.values(players).every(p => p.isFinished);
      if (allFinished) {
        MultiplayerService.finishGame(roomCode);
      }
    }
  }, [players, isHost]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const newTime = prev - 1;
        if (newTime <= 0) {
          if (!hasExpired.current) {
            hasExpired.current = true;
            clearInterval(interval);
            // Push final score to server
            MultiplayerService.updatePlayerScore(roomCode, playerId, latestScore.current).then(() => {
              if (!isHost) onExpire(); // Guests can just go to results
            });
          }
          return 0;
        }
        
        // Interval check for rank and score sync
        checkRank(newTime);
        
        return newTime;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [players]); // Re-subscribe when players object updates so rankings are accurate

  return (
    <Text style={[styles.timer, { color: timeLeft <= 10 ? 'red' : '#333' }]}>
      Time: {timeLeft}s
    </Text>
  );
};

const MultiplayerLobby = ({ navigation, roomCode, playerId, isHost }) => {
  const [roomData, setRoomData] = useState(null);
  const [activeTab, setActiveTab] = useState('Lobby');
  const [settingsDraft, setSettingsDraft] = useState(null);

  useEffect(() => {
    const unsubscribe = MultiplayerService.subscribeToRoom(roomCode, (data) => {
      if (!data) {
        Alert.alert("Room Closed", "The room is no longer available.");
        navigation.navigate("Menu");
        return;
      }

      // Check if host has changed
      if (data.hostId && data.hostId !== (roomData?.hostId)) {
        const amIHost = data.hostId === playerId;
        navigation.setRoomState({ roomCode, isHost: amIHost });
        if (amIHost && !isHost) {
          Alert.alert("Host Transfer", "The previous host left. You are now the host!");
        }
      }

      // If host disconnected (hostId no longer in players list), and I'm the first player, take over
      const playerIds = Object.keys(data.players || {});
      if (data.hostId && !playerIds.includes(data.hostId)) {
        if (playerIds[0] === playerId) {
          MultiplayerService.transferHost(roomCode, playerId);
        }
      }

      setRoomData(data);
      // Initialize settings draft if not yet set (for the host)
      if ((data.hostId === playerId) && !settingsDraft) {
        setSettingsDraft(data.settings);
      }
      if (data.status === 'playing') {
        navigation.setMpCountingDown(true);
        navigation.navigate("MultiplayerGame");
      } else if (data.status === 'finished') {
        navigation.navigate("MultiplayerResults");
      }
    });
    return () => unsubscribe();
  }, [roomCode, isHost, playerId, roomData?.hostId]);

  const handleStartGame = () => {
    MultiplayerService.startGame(roomCode);
  };

  const toggleReady = () => {
    const myPlayer = roomData.players[playerId];
    const newStatus = myPlayer.status === "ready" ? "not_ready" : "ready";
    MultiplayerService.updatePlayerStatus(roomCode, playerId, newStatus);
  };

  // Local-only draft updates for Host
  const updateDraft = (key, val) => {
    setSettingsDraft(prev => ({ ...prev, [key]: val }));
  };

  const toggleOperationDraft = (op) => {
    let newOps = [...(settingsDraft.operations || [])];
    if (newOps.includes(op)) {
      if (newOps.length > 1) {
        newOps = newOps.filter(o => o !== op);
      }
    } else {
      newOps.push(op);
    }
    updateDraft('operations', newOps);
  };

  const saveSettings = async () => {
    if (!isHost) return;

    const parsedMin = parseInt(settingsDraft.minNumber);
    const parsedMax = parseInt(settingsDraft.maxNumber);

    if (isNaN(parsedMin) || isNaN(parsedMax)) {
      Alert.alert("Error", "Min and Max numbers must be valid numbers.");
      return;
    }

    if (parsedMin >= parsedMax) {
      Alert.alert("Error", "Minimum number must be less than maximum number.");
      return;
    }

    try {
      await MultiplayerService.updateRoomSettings(roomCode, {
        ...settingsDraft,
        minNumber: parsedMin,
        maxNumber: parsedMax,
      });
      Alert.alert("Success", "Game settings updated for all players!");
    } catch (e) {
      Alert.alert("Error", "Failed to save settings: " + e.message);
    }
  };

  const isSettingsChanged = useMemo(() => {
    if (!isHost || !settingsDraft || !roomData) return false;
    return JSON.stringify(settingsDraft) !== JSON.stringify(roomData.settings);
  }, [settingsDraft, roomData, isHost]);

  if (!roomData) return <View style={styles.container}><Text>Loading Lobby...</Text></View>;

  const players = Object.entries(roomData.players || {});
  const allReady = players.every(([_, p]) => p.status === "ready");
  const myStatus = roomData.players[playerId]?.status || "not_ready";

  const renderLobbyTab = () => (
    <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
      <Text style={styles.sectionHeader}>Players Joined ({players.length})</Text>
      {players.map(([pId, p], i) => (
        <View key={i} style={styles.leaderboardRow}>
          <View>
            <Text style={styles.leaderboardLabel}>
              {p.nickname} {p.isHost ? '(Host)' : ''}
            </Text>
            <Text style={[styles.statusBadgeText, { color: p.status === "ready" ? "green" : p.status === "viewing_scores" ? "orange" : "red" }]}>
              {p.status === "ready" ? "Ready!" : p.status === "viewing_scores" ? "Viewing Results" : "Not Ready"}
            </Text>
          </View>
          {isHost && pId !== playerId && (
             <TouchableOpacity 
               style={{ backgroundColor: 'red', padding: 5, borderRadius: 5 }}
               onPress={() => {
                 Alert.alert("Kick Player", `Are you sure you want to kick ${p.nickname}?`, [
                   { text: "Cancel", style: "cancel" },
                   { text: "Kick", onPress: () => MultiplayerService.kickPlayer(roomCode, pId), style: 'destructive' }
                 ]);
               }}
             >
               <Text style={{ color: 'white', fontWeight: 'bold' }}>KICK</Text>
             </TouchableOpacity>
          )}
        </View>
      ))}

      <TouchableOpacity 
        style={[styles.menuButton, { backgroundColor: myStatus === "ready" ? "#28a745" : "#dc3545", marginTop: 30 }]} 
        onPress={toggleReady}
      >
        <Text style={styles.menuButtonText}>{myStatus === "ready" ? "I'M READY!" : "CLICK TO READY"}</Text>
      </TouchableOpacity>

      {isHost && (
        <TouchableOpacity 
          style={[styles.menuButton, { marginTop: 20, opacity: allReady ? 1 : 0.5 }]} 
          onPress={handleStartGame}
          disabled={!allReady}
        >
          <Text style={styles.menuButtonText}>{allReady ? "START GAME" : "WAITING FOR OTHERS..."}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );

  const renderSettingsTab = () => {
    const currentSettings = isHost ? settingsDraft : roomData.settings;
    if (!currentSettings) return null;

    return (
      <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <Text style={styles.sectionHeader}>Match Operations</Text>
        <View style={styles.operationsRow}>
          {['+', '-', '*', '/', '^2', 'root'].map((op) => (
            <TouchableOpacity
              key={op}
              style={[
                styles.opBadge,
                currentSettings.operations.includes(op) && styles.opBadgeActive,
                !isHost && { opacity: 0.5 }
              ]}
              onPress={() => isHost && toggleOperationDraft(op)}
              disabled={!isHost}
            >
              <Text style={[styles.opBadgeText, currentSettings.operations.includes(op) && styles.opBadgeTextActive]}>
                {op === '/' ? '÷' : op === '*' ? '×' : op === '^2' ? 'x²' : op === 'root' ? '√' : op}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionHeader, { marginTop: 20 }]}>Custom Number Range</Text>
        <View style={{ flexDirection: 'row', width: '100%', justifyContent: 'space-between' }}>
          <View style={[styles.zenModeContainer, { marginTop: 10, width: '48%', minHeight: 80, flexDirection: 'column', justifyContent: 'center' }]}>
            <Text style={styles.zenModeText}>Min (Inclusive)</Text>
             <TextInput
                style={[styles.nicknameInput, { flex: 1, textAlign: 'center' }, !isHost && { color: '#666' }]}
                placeholder="Min (default 0)"
                value={String(currentSettings.minNumber ?? 0)}
                onChangeText={(val) => isHost && updateDraft('minNumber', val)}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                editable={isHost}
             />
          </View>
          <View style={[styles.zenModeContainer, { marginTop: 10, width: '48%', minHeight: 80, flexDirection: 'column', justifyContent: 'center' }]}>
            <Text style={styles.zenModeText}>Max (Inclusive)</Text>
             <TextInput
                style={[styles.nicknameInput, { flex: 1, textAlign: 'center' }, !isHost && { color: '#666' }]}
                placeholder="Max (default 12)"
                value={String(currentSettings.maxNumber ?? 12)}
                onChangeText={(val) => isHost && updateDraft('maxNumber', val)}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                editable={isHost}
             />
          </View>
        </View>

        <View style={styles.zenModeContainer}>
          <Text style={styles.zenModeText}>Allow Zero</Text>
          <Switch
            value={!!currentSettings.allowZero}
            onValueChange={(val) => isHost && updateDraft('allowZero', val)}
            color="#007bff"
            disabled={!isHost}
          />
        </View>

        <View style={styles.zenModeContainer}>
          <Text style={styles.zenModeText}>Allow Negative</Text>
          <Switch
            value={!!currentSettings.allowNegative}
            onValueChange={(val) => isHost && updateDraft('allowNegative', val)}
            color="#007bff"
            disabled={!isHost}
          />
        </View>

        {isHost && (
          <TouchableOpacity 
            style={[styles.menuButton, { marginTop: 40, backgroundColor: isSettingsChanged ? '#007bff' : '#6c757d', opacity: isSettingsChanged ? 1 : 0.6 }]} 
            onPress={saveSettings}
            disabled={!isSettingsChanged}
          >
            <Text style={styles.menuButtonText}>SAVE GAME SETTINGS</Text>
          </TouchableOpacity>
        )}
        {!isHost && (
          <Text style={[styles.statusText, { marginTop: 20, textAlign: 'center' }]}>Only the host can modify match settings.</Text>
        )}

        <TouchableOpacity
          style={[styles.menuButton, { marginTop: 40 }]}
          onPress={() => {
            MultiplayerService.leaveRoom(roomCode, playerId, isHost);
            navigation.navigate("Menu");
          }}
        >
          <Text style={styles.menuButtonText}>Back to Menu</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(roomCode);
    Alert.alert("Copied!", "Room code copied to clipboard.");
  };

  return (
    <View style={styles.container}>
      <MathBackground />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <View style={{ marginLeft: '10%', flexDirection: 'row', alignItems: 'center' }}>
          <Appbar.BackAction size={32} onPress={() => {
            MultiplayerService.leaveRoom(roomCode, playerId, isHost);
            navigation.navigate("Menu");
          }} />
        </View>
        <TouchableOpacity 
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} 
          onPress={copyToClipboard}
          activeOpacity={0.7}
        >
          <Appbar.Content 
            title={`Room Code: ${roomCode}`} 
            titleStyle={{ fontFamily: KID_FONT, fontSize: 18, color: '#333' }} 
          />
          <Appbar.Action icon="content-copy" onPress={copyToClipboard} size={20} />
        </TouchableOpacity>
      </Appbar.Header>

      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'Lobby' && styles.activeTab]} 
          onPress={() => setActiveTab('Lobby')}
        >
          <Text style={[styles.tabText, activeTab === 'Lobby' && styles.activeTabText]}>Lobby</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'Settings' && styles.activeTab]} 
          onPress={() => setActiveTab('Settings')}
        >
          <Text style={[styles.tabText, activeTab === 'Settings' && styles.activeTabText]}>Settings</Text>
        </TouchableOpacity>
      </View>
      
      <View style={{ flex: 1 }}>
        {activeTab === 'Lobby' ? renderLobbyTab() : renderSettingsTab()}
      </View>

      <TouchableOpacity
        style={[styles.menuButton, { marginTop: 10, marginBottom: 20, alignSelf: 'center' }]}
        onPress={() => {
          MultiplayerService.leaveRoom(roomCode, playerId, isHost);
          navigation.navigate("Menu");
        }}
      >
        <Text style={styles.menuButtonText}>Back to Menu</Text>
      </TouchableOpacity>
    </View>
  );
};

const SettingsScreen = ({ navigation, isSafetyMode, setIsSafetyMode, totalPlayTime, playTimeToday }) => {
  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    let res = '';
    if (hrs > 0) res += `${hrs}h `;
    if (mins > 0 || hrs > 0) res += `${mins}m `;
    res += `${secs}s`;
    return res;
  };

  const today = new Date().toLocaleDateString();

  return (
    <View style={styles.container}>
      <MathBackground />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <View style={{ marginLeft: '10%', flexDirection: 'row', alignItems: 'center' }}>
          <Appbar.BackAction size={32} onPress={() => navigation.navigate("Menu")} />
        </View>
        <Appbar.Content title="Settings" titleStyle={{ fontFamily: KID_FONT, color: '#333' }} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.gameBody}>
          <Text style={styles.sectionHeader}>Local Stats</Text>
          <View style={[styles.zenModeContainer, { flexDirection: 'column', alignItems: 'flex-start', height: 'auto', paddingVertical: 15 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 10 }}>
              <Text style={styles.zenModeText}>Total Play Time</Text>
              <Text style={[styles.zenModeText, { color: '#007bff' }]}>{formatTime(totalPlayTime)}</Text>
            </View>
            <View style={{ height: 1, backgroundColor: '#eee', width: '100%', marginVertical: 10 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <Text style={styles.zenModeText}>{today}</Text>
              <Text style={[styles.zenModeText, { color: '#007bff' }]}>Playtime: {formatTime(playTimeToday)}</Text>
            </View>
          </View>

          <Text style={[styles.sectionHeader, { marginTop: 20 }]}>Accessibility</Text>
          <View style={styles.zenModeContainer}>
            <View style={{ flex: 1, paddingRight: 10 }}>
               <Text style={styles.zenModeText}>Safety Mode (Reduce Motion)</Text>
               <Text style={{ fontSize: 12, color: '#666', marginTop: 5, fontFamily: KID_FONT }}>Disables flashing lights and rapid animations.</Text>
            </View>
            <Switch
              value={isSafetyMode}
              onValueChange={setIsSafetyMode}
              color="#007bff"
            />
          </View>

          <Text style={[styles.sectionHeader, { marginTop: 20 }]}>App Info</Text>
          <View style={[styles.zenModeContainer, { height: 'auto', paddingVertical: 15 }]}>
            <Text style={styles.zenModeText}>Version</Text>
            <Text style={[styles.zenModeText, { color: '#666' }]}>{Constants.expoConfig?.version || '1.0.0'}</Text>
          </View>

        <TouchableOpacity
          style={[styles.menuButton, { marginTop: 40, backgroundColor: 'grey' }]}
          onPress={() => navigation.navigate("Menu")}
        >
          <Text style={styles.menuButtonText}>Back to Menu</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </View>
  );
};

const MainMenu = ({ navigation, currentStreak, adsRemoved, requestPurchase, restorePurchases }) => {
  const handleRemoveAds = () => {
    Alert.alert(
      "Remove Ads",
      "Remove all ads forever for $0.99?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Buy ($0.99)", 
          onPress: () => requestPurchase()
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <MathBackground />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <View style={{ position: 'absolute', top: 10, left: 10, zIndex: 10 }}>
          {!adsRemoved && (
            <TouchableOpacity 
              onPress={handleRemoveAds}
              style={{ 
                backgroundColor: 'rgba(255, 215, 0, 0.8)', 
                paddingHorizontal: 12, 
                paddingVertical: 6, 
                borderRadius: 20,
                borderWidth: 1,
                borderColor: '#DAA520',
                marginBottom: 5
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#8B4513', fontFamily: KID_FONT }}>
                REMOVE ADS ($0.99)
              </Text>
            </TouchableOpacity>
          )}
          {!adsRemoved && (
            <TouchableOpacity onPress={() => restorePurchases()}>
              <Text style={{ fontSize: 10, color: '#666', fontFamily: KID_FONT, textAlign: 'center' }}>
                Restore
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <Appbar.Content title="" />
        {currentStreak > 0 && (
          <View style={styles.streakContainer}>
            <Text style={styles.streakText}>{currentStreak} 🔥</Text>
          </View>
        )}
      </Appbar.Header>
      <View style={styles.gameBody}>
        <View style={styles.titleContainer}>
          <Text style={styles.titleText}>Mathly</Text>
          <Text style={[styles.titleText, { color: '#007bff' }]}>Addicted</Text>
        </View>
        
        <View style={{ backgroundColor: '#fff3cd', padding: 10, borderRadius: 10, marginBottom: 20, width: '80%', borderWidth: 1, borderColor: '#ffeeba' }}>
           <Text style={{ color: '#856404', textAlign: 'center', fontFamily: KID_FONT, fontSize: 12 }}>
             ⚠️ Warning: This game contains flashing lights. 
             {"\n"}Go to <Text style={{ fontWeight: 'bold' }}>SETTINGS</Text> to enable Safety Mode.
           </Text>
        </View>

        <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate("GameModes")}>
          <Text style={styles.menuButtonText}>PLAY</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate("MultiplayerMenu")}>
          <Text style={styles.menuButtonText}>MULTIPLAYER</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate("Leaderboard")}>
          <Text style={styles.menuButtonText}>SCORES</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate("Settings")}>
          <Text style={styles.menuButtonText}>SETTINGS</Text>
        </TouchableOpacity>
      </View>
      <View style={{ position: 'absolute', bottom: 0, width: '100%', alignItems: 'center' }}>
        <BannerAd
          unitId={adUnitIdBanner}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{
            requestNonPersonalizedAdsOnly: true,
          }}
        />
      </View>
    </View>
  );
};

const generateOptions = (answer, rng = Math.random) => {
  return [answer - 1, answer, answer + 1].sort(() => rng() - 0.5);
};

const GameOver = ({ score, stats, navigation, adsRemoved }) => {
  const [interstitialLoaded, setInterstitialLoaded] = useState(false);

  useEffect(() => {
    if (adsRemoved) return;

    const interstitial = InterstitialAd.createForAdRequest(adUnitIdInterstitial, {
      requestNonPersonalizedAdsOnly: true,
    });

    const unsubscribe = interstitial.addAdEventListener(AdEventType.LOADED, () => {
      interstitial.show();
      setInterstitialLoaded(true);
    });

    interstitial.load();

    return () => {
      unsubscribe();
    };
  }, [adsRemoved]);

  const summary = useMemo(() => {
    const safeStats = stats || [];
    const total = safeStats.length;
    const correctStats = safeStats.filter(s => s && s.correct);
    const correct = correctStats.length;
    const incorrect = safeStats.filter(s => s && !s.correct).length;
    const totalTime = safeStats.reduce((acc, curr) => acc + (curr ? curr.timeTaken : 0), 0);
    const avgTime = total > 0 ? (totalTime / total / 1000).toFixed(2) : "0.00";

    const sortedByTime = [...safeStats].sort((a, b) => (b?.timeTaken || 0) - (a?.timeTaken || 0));
    const slowest = sortedByTime.length > 0 ? sortedByTime[0] : null;
    const fastest = sortedByTime.length > 0 ? sortedByTime[sortedByTime.length - 1] : null;

    return { total, correct, incorrect, avgTime, slowest, fastest };
  }, [stats]);

  return (
    <View style={styles.container}>
      <MathBackground operatorColor="rgba(255, 120, 120, 1)" count={40} />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <Appbar.Content title="Game Over" titleStyle={{ fontFamily: KID_FONT, color: '#333' }} />
      </Appbar.Header>
      <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <View style={styles.titleContainer}>
          <Text style={[styles.titleText, { fontSize: 36 }]}>Result</Text>
          <Text style={[styles.score, { fontSize: 48 }]}>{score}</Text>
        </View>

        <View style={styles.statsDashboard}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{summary.total}</Text>
            <Text style={styles.statLabel}>Solved</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{summary.avgTime}s</Text>
            <Text style={styles.statLabel}>Avg Time</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: 'red' }]}>{summary.incorrect}</Text>
            <Text style={styles.statLabel}>Wrong</Text>
          </View>
        </View>

        <View style={[styles.zenModeContainer, { flexDirection: 'column', height: 'auto', padding: 15 }]}>
          <Text style={styles.sectionHeader}>Speed Analysis</Text>
          {summary.slowest ? (
            <>
              <View style={styles.analysisRow}>
                <Text style={styles.analysisLabel}>🐢 Slowest:</Text>
                <Text style={styles.analysisValue}>{summary.slowest.question} ({(summary.slowest.timeTaken / 1000).toFixed(2)}s)</Text>
              </View>
              <View style={styles.analysisRow}>
                <Text style={styles.analysisLabel}>⚡ Fastest:</Text>
                <Text style={styles.analysisValue}>{summary.fastest.question} ({(summary.fastest.timeTaken / 1000).toFixed(2)}s)</Text>
              </View>
            </>
          ) : (
            <Text style={{ textAlign: 'center', marginVertical: 10 }}>No stats available</Text>
          )}
        </View>

        {summary.incorrect > 0 && (
          <View style={{ width: '100%', marginTop: 10 }}>
            <Text style={styles.sectionHeader}>Review Mistakes</Text>
            {stats.filter(s => s && !s.correct).map((item, index) => (
              <View key={index} style={styles.mistakeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mistakeQuestion}>{item.question} = {item.answer}</Text>
                  <Text style={styles.mistakeUserAnswer}>You said: {item.userChoice}</Text>
                </View>
                <Text style={styles.mistakeTime}>{(item.timeTaken / 1000).toFixed(1)}s</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.menuButton, { backgroundColor: 'grey' }]}
          onPress={() => {
            navigation.resetGame();
            navigation.navigate("Menu");
          }}
        >
          <Text style={styles.menuButtonText}>BACK TO MENU</Text>
        </TouchableOpacity>
      </ScrollView>
      <View style={{ alignItems: 'center', justifyContent: 'center', width: '100%' }}>
        <BannerAd
          unitId={adUnitIdBanner}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{
            requestNonPersonalizedAdsOnly: true,
          }}
        />
      </View>
    </View>
  );
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function App() {
  const dingSound = useRef(null);
  const quackSound = useRef(null);

  const { connected, availablePurchases, fetchProducts, requestPurchase: requestPurchaseIAP, finishTransaction, getAvailablePurchases } = useIAP({
    onPurchaseSuccess: async (purchase) => {
      try {
        await finishTransaction({ purchase, isConsumable: false });
        setAdsRemoved(true);
        Alert.alert("Success", "Ads have been removed! Thank you.");
      } catch (err) {
        console.warn('Finish Transaction Error:', err);
      }
    },
    onPurchaseError: (error) => {
      console.warn('Purchase Error', error);
      if (error.code !== ErrorCode.UserCancelled) {
        Alert.alert('Purchase Error', error.message || 'Transaction failed');
      }
    },
  });

  useEffect(() => {
    if (connected) {
      fetchProducts({ skus: [IAP_PRODUCT_ID], type: 'in-app' });
      restorePurchases(true);
    }
  }, [connected]);

  const requestPurchase = async () => {
    try {
      await requestPurchaseIAP({
        request: {
          apple: { sku: IAP_PRODUCT_ID },
          google: { skus: [IAP_PRODUCT_ID] },
        },
      });
    } catch (err) {
      console.warn('Purchase Request Error', err);
      Alert.alert('Purchase Error', 'Could not initiate purchase');
    }
  };

  const restorePurchases = async (silent = false) => {
    try {
      await getAvailablePurchases();
      // Note: availablePurchases is a state variable updated by getAvailablePurchases()
      // Since availablePurchases might not be updated immediately in this tick, 
      // we might need a separate useEffect to handle the results if we want it to be perfectly reactive to the restore button.
      // However, for the initial check on mount, it's safer to use the state in a useEffect.
    } catch (err) {
      console.warn('Restore Error', err);
      if (!silent) Alert.alert("Error", "Could not restore purchases.");
    }
  };

  useEffect(() => {
    if (availablePurchases && availablePurchases.length > 0) {
      const restored = availablePurchases.some(p => p.productId === IAP_PRODUCT_ID);
      if (restored) {
        setAdsRemoved(true);
        // We don't want to show "Restored" alert every time on mount if it was silent
      }
    }
  }, [availablePurchases]);

  useEffect(() => {
    // This listener fires whenever a notification is received while the app is foregrounded
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification Received in Foreground:', notification);
      Alert.alert(
        notification.request.content.title || 'Notification Received!',
        notification.request.content.body,
        [{ text: 'Awesome!' }]
      );
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    async function loadSounds() {
      try {
        // Set global audio mode for better control
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: false, // Respect silent mode
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });

        const { sound: ding } = await Audio.Sound.createAsync(
          require('./assets/ding.mp3'),
          { volume: 0.1 } // Very low volume as requested
        );
        dingSound.current = ding;

        const { sound: quack } = await Audio.Sound.createAsync(
          require('./assets/quack.mp3'),
          { volume: 0.3 }
        );
        quackSound.current = quack;
      } catch (error) {
        console.log('Error loading sounds:', error);
      }
    }

    loadSounds();

    return () => {
      if (dingSound.current) dingSound.current.unloadAsync();
      if (quackSound.current) quackSound.current.unloadAsync();
    };
  }, []);

  useEffect(() => {
    mobileAds()
      .setRequestConfiguration({
        // Update your request configuration here
        tagForChildDirectedTreatment: true,
        maxAdContentRating: MaxAdContentRating.G,
        tagForUnderAgeOfConsent: true,
      })
      .then(() => {
        mobileAds()
          .initialize()
          .then(adapterStatuses => {
            // Initialization complete!
          });
      });
  }, []);

  async function playDing() {
    try {
      if (dingSound.current) {
        await dingSound.current.stopAsync();
        await dingSound.current.setVolumeAsync(0.1);
        await dingSound.current.playAsync();
      }
    } catch (error) {
      console.log('Error playing ding:', error);
    }
  }

  async function playQuack() {
    try {
      if (quackSound.current) {
        await quackSound.current.stopAsync();
        await quackSound.current.setVolumeAsync(0.3);
        await quackSound.current.playAsync();
      }
    } catch (error) {
      console.log('Error playing quack:', error);
    }
  }

  useEffect(() => {
    // Ensure the root container is transparent or matches the desired background
  }, []);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(0);
  const [currentOptions, setCurrentOptions] = useState([]);
  const [timer, setTimer] = useState(5);
  const [questionId, setQuestionId] = useState(0);
  const timerAnim = useRef(new Animated.Value(5)).current;

  // Dedicated Multiplayer Local States
  const mpTimerAnim = useRef(new Animated.Value(5)).current;
  const [mpQuestionTimer, setMpQuestionTimer] = useState(5);
  const [mpQuestionId, setMpQuestionId] = useState(0);

  const [borderColor, setBorderColor] = useState('transparent');
  const flashAnim = useRef(new Animated.Value(0)).current;
  const [selectedOperations, setSelectedOperations] = useState(operations);
  const [screen, setScreen] = useState('Menu');
  const [isPaused, setIsPaused] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [isWaitingToStart, setIsWaitingToStart] = useState(false);
  const [lastPoints, setLastPoints] = useState(null);
  const pointsFadeAnim = useRef(new Animated.Value(0)).current;
  const [incorrectAnswers, setIncorrectAnswers] = useState([]);
  const [gameStats, setGameStats] = useState([]);
  const questionStartTime = useRef(Date.now());
  const [isZenMode, setIsZenMode] = useState(false);
  const [isSafetyMode, setIsSafetyMode] = useState(false);
  const [minNumber, setMinNumber] = useState(1);
  const [maxNumber, setMaxNumber] = useState(10);
  const [allowZero, setAllowZero] = useState(false);
  const [allowNegative, setAllowNegative] = useState(false);
  const [savedGames, setSavedGames] = useState({});
  const [adsRemoved, setAdsRemoved] = useState(false);

  // Multiplayer State
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [playerId, setPlayerId] = useState('');
  const [multiplayerRoomData, setMultiplayerRoomData] = useState(null);
  const [currentRank, setCurrentRank] = useState(null);

  // New local stats states
  const [totalPlayTime, setTotalPlayTime] = useState(0); // in seconds
  const [playTimeToday, setPlayTimeToday] = useState(0); // in seconds
  const [currentStreak, setCurrentStreak] = useState(0);
  const [problemsSolvedToday, setProblemsSolvedToday] = useState(0);
  const [lastDateSolved, setLastDateSolved] = useState(null);

  // Load local stats on mount
  useEffect(() => {
    const loadLocalStats = async () => {
      try {
        const statsJson = await AsyncStorage.getItem('local_stats');
        if (statsJson) {
          const stats = JSON.parse(statsJson);
          setTotalPlayTime(stats.totalPlayTime || 0);
          setPlayTimeToday(stats.playTimeToday || 0);
          setCurrentStreak(stats.currentStreak || 0);
          setProblemsSolvedToday(stats.problemsSolvedToday || 0);
          setLastDateSolved(stats.lastDateSolved || null);
          setAdsRemoved(!!stats.adsRemoved);

          // Check if streak should reset
          const today = new Date().toISOString().split('T')[0];
          if (stats.lastDateSolved !== today) {
            setPlayTimeToday(0);
          }

          if (stats.lastDateSolved) {
            const lastDate = new Date(stats.lastDateSolved);
            const todayDate = new Date();
            todayDate.setHours(0, 0, 0, 0);
            lastDate.setHours(0, 0, 0, 0);
            
            const diffTime = Math.abs(todayDate - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 1) {
              // Streak broken
              setCurrentStreak(0);
              setProblemsSolvedToday(0);
            } else if (diffDays === 1) {
              // New day, reset problems solved today
              setProblemsSolvedToday(0);
            }
          }
        }
      } catch (e) {
        console.error("Failed to load local stats", e);
      }
    };
    loadLocalStats();
    requestNotificationPermissions();
  }, []);

  // Save local stats whenever they change
  useEffect(() => {
    const saveLocalStats = async () => {
      const stats = { totalPlayTime, playTimeToday, currentStreak, problemsSolvedToday, lastDateSolved, adsRemoved };
      try {
        await AsyncStorage.setItem('local_stats', JSON.stringify(stats));
      } catch (e) {
        console.error("Failed to save local stats", e);
      }
    };
    saveLocalStats();
  }, [totalPlayTime, playTimeToday, currentStreak, problemsSolvedToday, lastDateSolved, adsRemoved]);

  // Track active play time
  useEffect(() => {
    let interval;
    if (screen === 'Game' || screen === 'MultiplayerGame') {
      interval = setInterval(() => {
        setTotalPlayTime(prev => prev + 1);
        setPlayTimeToday(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [screen]);

  // Notification logic
  const requestNotificationPermissions = async () => {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  };

  const scheduleStreakWarning = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Schedule for 10 PM today if not already solved 5 problems
    if (problemsSolvedToday < 5) {
      const now = new Date();
      const warningTime = new Date();
      warningTime.setHours(22, 0, 0, 0); // 10 PM

      if (warningTime > now) {
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Streak Warning! 🔥',
              body: 'Your streak expires in 2 hours! Solve 5 problems to keep it alive!',
              sound: 'default',
            },
            trigger: {
              type: 'date',
              date: warningTime,
            },
          });
        } catch (e) {
          console.error('Failed to schedule streak warning:', e);
        }
      }
    }
  };

  useEffect(() => {
    scheduleStreakWarning();
  }, [problemsSolvedToday]);

  const gameModeKey = useMemo(() => {
    const ops = [...selectedOperations].sort().join('');
    return `leaderboard_${ops}_${isZenMode ? 'zen' : 'normal'}`;
  }, [selectedOperations, isZenMode]);

  const saveKey = useMemo(() => {
    const ops = [...selectedOperations].sort().join('');
    return `saved_game_${ops}_${isZenMode ? 'zen' : 'normal'}`;
  }, [selectedOperations, isZenMode]);

  useEffect(() => {
    const loadHighScore = async () => {
      try {
        const value = await AsyncStorage.getItem(gameModeKey);
        if (value !== null) {
          const scores = JSON.parse(value);
          if (scores && scores.length > 0) {
            setHighScore(scores[0].score);
          } else {
            setHighScore(0);
          }
        } else {
          setHighScore(0);
        }
      } catch (e) {
        console.error("Failed to load high score", e);
      }
    };
    loadHighScore();
  }, [gameModeKey]);

  useEffect(() => {
    const loadSavedGames = async () => {
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const savedKeys = allKeys.filter(key => key.startsWith('saved_game_'));
        const pairs = await AsyncStorage.multiGet(savedKeys);
        const savedMap = {};
        pairs.forEach(([key, value]) => {
          savedMap[key] = !!value;
        });
        setSavedGames(savedMap);
      } catch (e) {
        console.error("Failed to load saved games", e);
      }
    };
    loadSavedGames();
  }, [screen]);

  const saveGame = async () => {
    const gameState = {
      score,
      combo,
      strikes,
      question,
      answer,
      selectedOperations,
      isZenMode,
      isSafetyMode,
      incorrectAnswers,
      minNumber,
      maxNumber,
      allowZero,
      allowNegative,
    };
    try {
      await AsyncStorage.setItem(saveKey, JSON.stringify(gameState));
      setSavedGames(prev => ({ ...prev, [saveKey]: true }));
    } catch (e) {
      console.error("Failed to save game", e);
    }
  };

  const loadSavedGame = async (specificSaveKey) => {
    const keyToLoad = specificSaveKey || saveKey;
    try {
      const savedGame = await AsyncStorage.getItem(keyToLoad);
      if (savedGame) {
        const gameState = JSON.parse(savedGame);
        setScore(gameState.score);
        setCombo(gameState.combo);
        setStrikes(gameState.strikes);
        setQuestion(gameState.question);
        setAnswer(gameState.answer);
        setSelectedOperations(gameState.selectedOperations);
        setIsZenMode(gameState.isZenMode);
        setIsSafetyMode(gameState.isSafetyMode || false);
        setIncorrectAnswers(gameState.incorrectAnswers || []);
        setMinNumber(gameState.minNumber ?? 1);
        setMaxNumber(gameState.maxNumber ?? 10);
        setAllowZero(!!gameState.allowZero);
        setAllowNegative(!!gameState.allowNegative);
        
        await AsyncStorage.removeItem(keyToLoad);
        setSavedGames(prev => {
          const newMap = { ...prev };
          delete newMap[keyToLoad];
          return newMap;
        });
        setScreen('Game');
      }
    } catch (e) {
      console.error("Failed to load saved game", e);
    }
  };

  const strikesRef = useRef(strikes);
  const scoreRef = useRef(score);
  useEffect(() => { strikesRef.current = strikes; }, [strikes]);
  useEffect(() => { scoreRef.current = score; }, [score]);

  useEffect(() => {
    if (screen !== 'Game' || isPaused || isCountingDown || isZenMode) {
      if (screen !== 'Game') {
        timerAnim.setValue(5);
      } else {
        timerAnim.stopAnimation();
      }
      return;
    }

    if (timer === 0) {
      const currentStrikes = strikesRef.current;
      const currentScore = scoreRef.current;
      const newStrikes = currentStrikes + 1;
      const timeTaken = Date.now() - questionStartTime.current;
      const statsEntry = { question, answer, userChoice: 'Timed Out', correct: false, timeTaken };
      
      setIncorrectAnswers(prev => [...prev, { question, answer, userChoice: 'Timed Out' }]);
      setGameStats(prev => [...prev, statsEntry]);

      playQuack();
      if (!isSafetyMode) {
        flashAnim.setValue(0.3);
        Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start();
      }
      setCombo(0);
      setStrikes(newStrikes);

      if (newStrikes >= 3) {
        if (currentScore > 0) {
          saveToLeaderboard(currentScore);
        }
        setIsPaused(true);
        setScreen("GameOver");
      } else { startNewQuestion(); }
    }
    const interval = setInterval(() => setTimer((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(interval);
  }, [timer, screen, isPaused, isCountingDown, isZenMode, question, answer]);

  useEffect(() => {
    if (screen === 'Game') {
      setIsWaitingToStart(true);
      setIsPaused(true);
      startNewQuestion();
    }
  }, [screen]);

  // Handle local single-player shrinking animation (synced to Question ID)
  useEffect(() => {
    if (screen !== 'Game' || isPaused || isCountingDown || isZenMode) {
      timerAnim.stopAnimation();
      timerAnim.setValue(5);
      return;
    }

    // Hard reset on every new question ID
    timerAnim.stopAnimation();
    timerAnim.setValue(5);
    Animated.timing(timerAnim, {
      toValue: 0,
      duration: 5000,
      useNativeDriver: false,
    }).start();
  }, [questionId, screen, isPaused, isCountingDown, isZenMode]);

  const handleStartGame = () => {
    setIsWaitingToStart(false);
    setIsCountingDown(true);
    setCountdown(3);
  };
  useEffect(() => {
    if (!isCountingDown) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(interval); setIsCountingDown(false); setIsPaused(false); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isCountingDown]);

  const saveToLeaderboard = async (finalScore) => {
    try {
      const value = await AsyncStorage.getItem(gameModeKey);
      let scores = value ? JSON.parse(value) : [];
      
      const isTop10 = scores.length < 10 || finalScore > scores[scores.length - 1].score;
      
      if (isTop10) {
        Alert.prompt(
          "New High Score!",
          "Enter your name for the leaderboard:",
          [
            {
              text: "Cancel",
              style: "cancel"
            },
            {
              text: "OK",
              onPress: async (name) => {
                const newEntry = { name: name || 'Anonymous', score: finalScore, date: new Date().toLocaleDateString() };
                scores.push(newEntry);
                scores.sort((a, b) => b.score - a.score);
                scores = scores.slice(0, 10);
                await AsyncStorage.setItem(gameModeKey, JSON.stringify(scores));
                if (scores[0].score === finalScore) {
                  setHighScore(finalScore);
                }
              }
            }
          ],
          'plain-text'
        );
      }
    } catch (e) {
      console.error("Failed to save to leaderboard", e);
    }
  };

  const startNewQuestion = () => {
    const newQuestion = generateQuestion(selectedOperations, maxNumber, allowZero, allowNegative, minNumber);
    setQuestion(newQuestion.question);
    setAnswer(newQuestion.answer);
    setCurrentOptions(generateOptions(newQuestion.answer));
    setTimer(5);
    setQuestionId(prev => prev + 1);
    setBorderColor('transparent');
    questionStartTime.current = Date.now();
  };

  const handleAnswer = (userAnswer) => {
    if (isPaused || isCountingDown) return;
    const timeTaken = Date.now() - questionStartTime.current;
    const isCorrect = parseInt(userAnswer) === answer;
    const statsEntry = { question, answer, userChoice: userAnswer, correct: isCorrect, timeTaken };
    setGameStats(prev => [...prev, statsEntry]);

    if (isCorrect) {
      playDing();

      // Streak tracking logic
      const today = new Date().toISOString().split('T')[0];
      setProblemsSolvedToday(prev => {
        const newVal = prev + 1;
        if (newVal === 5) {
          // Increment streak if not already done today
          if (lastDateSolved !== today) {
            setCurrentStreak(s => s + 1);
            setLastDateSolved(today);
          }
        }
        return newVal;
      });

      let points = 100;
      if (combo >= 20) {
        points = 300;
      } else if (combo >= 10) {
        points = 200;
      }

      setLastPoints(points);
      pointsFadeAnim.stopAnimation();
      pointsFadeAnim.setValue(1);
      Animated.timing(pointsFadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setLastPoints(null);
        }
      });

      const newScore = score + points;
      setScore(newScore);
      if (newScore > highScore) {
        setHighScore(newScore);
      }
      setCombo((prev) => prev + 1);
      startNewQuestion();
    } else {
      playQuack();
      const newStrikes = strikes + 1;
      setIncorrectAnswers(prev => [...prev, { question, answer, userChoice: userAnswer }]);

      if (!isSafetyMode) {
        flashAnim.setValue(0.3);
        Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start();
      }
      setCombo(0);
      
      if (!isZenMode) {
        setStrikes(newStrikes);
        
        if (newStrikes >= 3) {
          if (score > 0) {
            saveToLeaderboard(score);
          }
          setIsPaused(true);
          setScreen("GameOver");
        } else { startNewQuestion(); }
      } else {
        startNewQuestion();
      }
    }
  };

  const navigation = {
    navigate: (screenName) => setScreen(screenName),
    setRoomState: ({ roomCode, isHost }) => { setRoomCode(roomCode); setIsHost(isHost); },
    setPlayerId: (id) => setPlayerId(id),
    setMpCountingDown: (val) => { setIsMpCountingDown(val); setIsPaused(val); },
    resetGame: () => { setScore(0); setStrikes(0); setCombo(0); setIncorrectAnswers([]); setGameStats([]); setIsPaused(false); flashAnim.setValue(0); },
    saveAndExit: async () => {
      if (isZenMode && score > 0) {
        await saveToLeaderboard(score);
      }
      await saveGame();
      setScreen('Menu');
    }
  };

  const [isMpCountingDown, setIsMpCountingDown] = useState(false);
  const [mpCountdown, setMpCountdown] = useState(3);

  useEffect(() => {
    if (screen === 'MultiplayerGame' || screen === 'MultiplayerLobby' || screen === 'MultiplayerResults') {
      const unsubscribe = MultiplayerService.subscribeToRoom(roomCode, (data) => {
        if (!data) {
          if (screen === 'MultiplayerGame' || screen === 'MultiplayerResults') {
            Alert.alert("Room Closed", "The room is no longer available.");
            setScreen('Menu');
          }
          return;
        }

        // Handle host transfer for global state
        if (data.hostId && data.hostId !== multiplayerRoomData?.hostId) {
          const amIHost = data.hostId === playerId;
          setIsHost(amIHost);
        }

        // Auto-transfer if host is gone from players list
        const playerIds = Object.keys(data.players || {});
        if (data.hostId && !playerIds.includes(data.hostId)) {
          if (playerIds[0] === playerId) {
            MultiplayerService.transferHost(roomCode, playerId);
          }
        }

        setMultiplayerRoomData(data);
        
        if (screen === 'MultiplayerGame') {
          if (data.status === 'finished') {
            setScreen('MultiplayerResults');
          } else if (data.status === 'waiting') {
            // Host reset the game to lobby
            setScreen('MultiplayerLobby');
          }
        } else if (screen === 'MultiplayerResults') {
           if (data.status === 'waiting') {
             setScreen('MultiplayerLobby');
           }
        }
      });
      return () => unsubscribe();
    }
  }, [screen, roomCode]);

  useEffect(() => {
    if (!isMpCountingDown) return;
    setMpCountdown(3);
    const interval = setInterval(() => {
      setMpCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsMpCountingDown(false);
          setIsPaused(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isMpCountingDown]);

  const mpColorAnim = useRef(new Animated.Value(0)).current;
  const mpProgressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (screen === 'MultiplayerGame') {
      Animated.spring(mpProgressAnim, {
        toValue: Math.min(combo / 21, 1),
        useNativeDriver: false,
      }).start();

      if (combo > 20 && !isSafetyMode) {
        Animated.loop(
          Animated.timing(mpColorAnim, {
            toValue: 1,
            duration: 5000,
            useNativeDriver: false,
          })
        ).start();
      } else {
        mpColorAnim.stopAnimation();
        mpColorAnim.setValue(0);
      }
    }
  }, [combo, screen, isSafetyMode]);

  // Handle local multiplayer question timer (number only)
  useEffect(() => {
    if (screen !== 'MultiplayerGame' || isPaused || isMpCountingDown) return;

    if (mpQuestionTimer === 0) {
      playQuack();
      if (!isSafetyMode) {
        flashAnim.setValue(0.3);
        Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start();
      }
      setCombo(0);

      const nextId = mpQuestionId + 1;
      const questionRNG = createSeededRNG((multiplayerRoomData?.seed || 0) + nextId);

      const newQuestion = generateQuestion(
        multiplayerRoomData?.settings.operations || ['+'],
        multiplayerRoomData?.settings.maxNumber || 10,
        multiplayerRoomData?.settings.allowZero || false,
        multiplayerRoomData?.settings.allowNegative || false,
        multiplayerRoomData?.settings.minNumber ?? 1,
        questionRNG
      );
      setQuestion(newQuestion.question);
      setAnswer(newQuestion.answer);
      setCurrentOptions(generateOptions(newQuestion.answer, questionRNG));
      setMpQuestionTimer(5);
      setMpQuestionId(nextId);
    }
    const interval = setInterval(() => setMpQuestionTimer((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(interval);
  }, [mpQuestionTimer, screen, isPaused, isMpCountingDown]);

  // Handle local multiplayer shrinking animation (synced to Question ID)
  useEffect(() => {
    if (screen !== 'MultiplayerGame' || isPaused || isMpCountingDown) {
      mpTimerAnim.stopAnimation();
      mpTimerAnim.setValue(5);
      return;
    }

    //Hard reset on every new question ID
    mpTimerAnim.stopAnimation();
    mpTimerAnim.setValue(5);
    Animated.timing(mpTimerAnim, {
      toValue: 0,
      duration: 5000,
      useNativeDriver: false,
    }).start();
  }, [mpQuestionId, screen, isPaused, isMpCountingDown]);

  useEffect(() => {
    if (screen === 'MultiplayerGame' && multiplayerRoomData?.seed !== undefined) {
      const startNewMatch = () => {
        const questionRNG = createSeededRNG(multiplayerRoomData.seed); // mpQuestionId starts at 0

        const newQuestion = generateQuestion(
          multiplayerRoomData?.settings.operations || ['+'],
          multiplayerRoomData?.settings.maxNumber || 10,
          multiplayerRoomData?.settings.allowZero || false,
          multiplayerRoomData?.settings.allowNegative || false,
          multiplayerRoomData?.settings.minNumber ?? 1,
          questionRNG
        );
        setQuestion(newQuestion.question);
        setAnswer(newQuestion.answer);
        setCurrentOptions(generateOptions(newQuestion.answer, questionRNG));
        setScore(0);
        setCombo(0);
        setMpQuestionTimer(5);
        setMpQuestionId(0);
      };
      startNewMatch();
    }
  }, [screen, multiplayerRoomData?.seed]);

  const handleMultiplayerAnswer = (userAnswer) => {
    // Explicitly stop and reset the shrinking circle animation on answer
    mpTimerAnim.stopAnimation();
    mpTimerAnim.setValue(5);

    const nextId = mpQuestionId + 1;
    const questionRNG = createSeededRNG((multiplayerRoomData?.seed || 0) + nextId);

    if (parseInt(userAnswer) === answer) {
      playDing();

      // Streak tracking logic
      const today = new Date().toISOString().split('T')[0];
      setProblemsSolvedToday(prev => {
        const newVal = prev + 1;
        if (newVal === 5) {
          // Increment streak if not already done today
          if (lastDateSolved !== today) {
            setCurrentStreak(s => s + 1);
            setLastDateSolved(today);
          }
        }
        return newVal;
      });

      let points = 100;
      if (combo >= 20) points = 300;
      else if (combo >= 10) points = 200;

      setLastPoints(points);
      pointsFadeAnim.stopAnimation();
      pointsFadeAnim.setValue(1);
      Animated.timing(pointsFadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setLastPoints(null);
        }
      });

      const newScore = score + points;
      setScore(newScore);
      setCombo(prev => prev + 1);

      const nextQuestion = generateQuestion(
        multiplayerRoomData.settings.operations,
        multiplayerRoomData.settings.maxNumber,
        multiplayerRoomData.settings.allowZero,
        multiplayerRoomData.settings.allowNegative,
        multiplayerRoomData.settings.minNumber,
        questionRNG
      );
      setQuestion(nextQuestion.question);
      setAnswer(nextQuestion.answer);
      setCurrentOptions(generateOptions(nextQuestion.answer, questionRNG));
      setMpQuestionTimer(5);
      setMpQuestionId(nextId);
    } else {
      playQuack();
      if (!isSafetyMode) {
        flashAnim.setValue(0.3);
        Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start();
      }
      setCombo(0);
      const nextQuestion = generateQuestion(
        multiplayerRoomData.settings.operations,
        multiplayerRoomData.settings.maxNumber,
        multiplayerRoomData.settings.allowZero,
        multiplayerRoomData.settings.allowNegative,
        multiplayerRoomData.settings.minNumber,
        questionRNG
      );
      setQuestion(nextQuestion.question);
      setAnswer(nextQuestion.answer);
      setCurrentOptions(generateOptions(nextQuestion.answer, questionRNG));
      setMpQuestionTimer(5);
      setMpQuestionId(nextId);
    }
  };

  return (
    <PaperProvider>
      <View style={styles.container}>
        {screen === "Menu" && (
          <MainMenu
            navigation={navigation}
            currentStreak={currentStreak}
            adsRemoved={adsRemoved}
            requestPurchase={requestPurchase}
            restorePurchases={restorePurchases}
          />
        )}
        {screen === "MultiplayerMenu" && (
          <MultiplayerMenu
            navigation={navigation}
            setNickname={setNickname}
            nickname={nickname}
          />
        )}
        {screen === "MultiplayerLobby" && (
          <MultiplayerLobby
            navigation={navigation}
            roomCode={roomCode}
            playerId={playerId}
            isHost={isHost}
          />
        )}
        {screen === "MultiplayerGame" && (
          <View style={styles.container}>
             <StatusBar hidden />
             <BorderProgressBar combo={combo} colorAnim={mpColorAnim} progressAnim={mpProgressAnim} />
             <View style={[StyleSheet.absoluteFill, { padding: BORDER_WIDTH }]} pointerEvents="box-none">
              <View style={{ flex: 1, borderRadius: INNER_RADIUS, backgroundColor: '#f0f0f0', overflow: 'hidden' }}>
                <MathBackground count={Math.min(combo, 30)} />
          <Appbar.Header style={{ width: '100%', backgroundColor: 'transparent' }}>
            <Appbar.Content title="" />
            <View style={styles.highScoreContainer}>
              <Text style={styles.highScoreText}>Best: {highScore}</Text>
            </View>
            <Appbar.Action icon="exit-to-app" size={32} onPress={handleExit} />
          </Appbar.Header>
                <Appbar.Header style={{ width: '100%', backgroundColor: 'transparent' }}>
                  <Appbar.Content title={`Room: ${roomCode}`} titleStyle={{ fontSize: 14, color: '#333' }} />
                  <Appbar.Action icon="exit-to-app" size={32} onPress={() => {
                    MultiplayerService.leaveRoom(roomCode, playerId, isHost);
                    setScreen("Menu");
                  }} />
                </Appbar.Header>
                {!isMpCountingDown && <CollapsingCircleTimer timerAnim={mpTimerAnim} combo={combo} />}
                <View style={styles.gameBody}>
                   <View style={styles.statsContainer}>
                      {!isMpCountingDown && (
                      <MultiplayerTimer 
                        onExpire={() => setScreen('MultiplayerResults')}
                        currentScore={score}
                        roomCode={roomCode}
                        playerId={playerId}
                        isHost={isHost}
                        players={multiplayerRoomData?.players || {}}
                        setRank={setCurrentRank}
                      />
                      )}
                      <Text style={styles.score}>Score: {score}</Text>
                   </View>
                   <View style={{ alignItems: 'center', height: 40, justifyContent: 'center' }}>
                      {lastPoints && (
                        <Animated.Text style={[styles.pointsPopup, { opacity: pointsFadeAnim }]}>
                          +{lastPoints}
                        </Animated.Text>
                      )}
                    </View>
                   <Text style={styles.question}>{question} = ?</Text>
                   <View style={styles.answerOptions}>
                    {currentOptions.map((option, index) => (
                      <TouchableOpacity key={index} style={styles.answerButton} onPress={() => handleMultiplayerAnswer(option)}>
                        <Text style={styles.answerButtonText}>{option}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {currentRank && (
                    <View style={styles.rankBadge}>
                      <Text style={styles.rankBadgeText}>Rank: {currentRank}</Text>
                    </View>
                  )}
                </View>
              </View>
             </View>
             <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'red', opacity: flashAnim, zIndex: 20000 }]} />
             {isMpCountingDown && (
                <View style={styles.countdownOverlay}>
                  <Text style={styles.countdownText}>{mpCountdown}</Text>
                </View>
              )}
          </View>
        )}
        {screen === "MultiplayerResults" && (
          <View style={styles.container}>
            <MathBackground />
            <Appbar.Header style={{ backgroundColor: 'transparent' }}>
               <Appbar.Content title="Round Results" titleStyle={{ fontFamily: KID_FONT, color: '#333' }} />
               <Appbar.Action icon="exit-to-app" size={32} onPress={() => {
                  MultiplayerService.leaveRoom(roomCode, playerId, isHost);
                  setScreen("Menu");
                }} />
            </Appbar.Header>
            <View style={styles.leaderboardBody}>
               <Text style={[styles.sectionHeader, { alignSelf: 'center', marginLeft: 0 }]}>Final Rankings</Text>
               <ScrollView style={{ width: '100%', marginTop: 20 }}>
                 {multiplayerRoomData && Object.values(multiplayerRoomData.players).sort((a,b) => b.score - a.score).map((p, i) => (
                   <View key={i} style={styles.scoreDetailRow}>
                      <Text style={styles.rankText}>{i + 1}.</Text>
                      <Text style={styles.nameText}>{p.nickname}</Text>
                      <Text style={styles.scoreText}>{p.score}</Text>
                   </View>
                 ))}
               </ScrollView>
               
               {isHost ? (
                 <TouchableOpacity style={[styles.menuButton, { marginTop: 20 }]} onPress={() => MultiplayerService.restartGame(roomCode)}>
                    <Text style={styles.menuButtonText}>PLAY AGAIN</Text>
                 </TouchableOpacity>
               ) : (
                 <Text style={[styles.statusText, { marginTop: 20 }]}>Waiting for host to restart...</Text>
               )}
               
               <TouchableOpacity style={[styles.menuButton, { marginTop: 10, backgroundColor: '#666' }]} onPress={() => {
                 MultiplayerService.leaveRoom(roomCode, playerId, isHost);
                 setScreen("Menu");
               }}>
                  <Text style={styles.menuButtonText}>BACK TO MENU</Text>
               </TouchableOpacity>
            </View>
          </View>
        )}
        {screen === "GameModes" && (
          <GameModes
            navigation={navigation}
            setOperations={setSelectedOperations}
            isZenMode={isZenMode}
            setIsZenMode={setIsZenMode}
            savedGames={savedGames}
            loadSavedGame={loadSavedGame}
            minNumber={minNumber}
            setMinNumber={setMinNumber}
            maxNumber={maxNumber}
            setMaxNumber={setMaxNumber}
            allowZero={allowZero}
            setAllowZero={setAllowZero}
            allowNegative={allowNegative}
            setAllowNegative={setAllowNegative}
          />
        )}
        {screen === "Settings" && (
          <SettingsScreen
            navigation={navigation}
            isSafetyMode={isSafetyMode}
            setIsSafetyMode={setIsSafetyMode}
            totalPlayTime={totalPlayTime}
            playTimeToday={playTimeToday}
          />
        )}
        {screen === "Leaderboard" && (
          <Leaderboard
            navigation={navigation}
            adsRemoved={adsRemoved}
          />
        )}
        {screen === "GameOver" && (
          <GameOver
            score={score}
            stats={gameStats}
            navigation={navigation}
            adsRemoved={adsRemoved}
          />
        )}
        {screen === "Game" && (
          <>
            <MainGame
              score={score}
              highScore={highScore}
              question={question}
              answer={answer}
              timer={timer}
              handleAnswer={handleAnswer}
              combo={combo}
              strikes={strikes}
              navigation={navigation}
              flashAnim={flashAnim}
              countdown={countdown}
              isCountingDown={isCountingDown}
              lastPoints={lastPoints}
              pointsFadeAnim={pointsFadeAnim}
              isZenMode={isZenMode}
              timerAnim={timerAnim}
              isSafetyMode={isSafetyMode}
              currentOptions={currentOptions}
            />
            {isWaitingToStart && (
              <TouchableOpacity
                activeOpacity={1}
                style={styles.countdownOverlay}
                onPress={handleStartGame}
              >
                <Text style={styles.startText}>Press anywhere to start</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  gameBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsContainer: {
    position: 'absolute',
    top: 20,
    width: '100%',
    alignItems: 'center',
    zIndex: 1,
  },
  borderBar: {
    position: 'absolute',
    zIndex: 10000,
  },
  strikesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  strikesLabel: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    fontFamily: KID_FONT,
  },
  strikeIcon: {
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 2,
    fontFamily: KID_FONT,
  },
  score: {
    fontSize: 30,
    fontWeight: 'bold',
    marginTop: 5,
    fontFamily: KID_FONT,
  },
  pointsPopup: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
    fontFamily: KID_FONT,
  },
  timer: {
    fontSize: 24,
    marginBottom: 20,
    fontFamily: KID_FONT,
  },
  question: {
    fontSize: 50,
    fontWeight: 'bold',
    marginBottom: 50,
    fontFamily: KID_FONT,
  },
  answerOptions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '90%',
    marginBottom: 50,
  },
  answerButton: {
    backgroundColor: '#007bff',
    paddingVertical: 20,
    paddingHorizontal: 30,
    minWidth: 100,
    alignItems: 'center',
    borderRadius: 15,
  },
  answerButtonText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    fontFamily: KID_FONT,
  },
  menuButton: {
    backgroundColor: '#007bff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    width: '80%',
    alignItems: 'center',
  },
  menuButtonText: {
    color: '#fff',
    fontSize: 24,
    fontFamily: KID_FONT,
  },
  titleContainer: {
    marginBottom: 50,
    alignItems: 'center',
  },
  titleText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#333',
    lineHeight: 55,
    textTransform: 'uppercase',
    fontFamily: KID_FONT,
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30000,
  },
  countdownText: {
    fontSize: 100,
    fontWeight: 'bold',
    color: '#fff',
  },
  startText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    paddingHorizontal: 20,
    fontFamily: KID_FONT,
  },
  zenModeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 15,
    marginBottom: 20,
    width: '85%',
    justifyContent: 'space-between',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    minHeight: 70,
  },
  zenModeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    fontFamily: KID_FONT,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    textTransform: 'uppercase',
    alignSelf: 'flex-start',
    marginLeft: '10%',
    marginBottom: 8,
    fontFamily: KID_FONT,
  },
  highScoreContainer: {
    marginRight: 10,
    justifyContent: 'center',
  },
  highScoreText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    fontFamily: KID_FONT,
  },
  divider: {
    height: 1,
    backgroundColor: '#ddd',
    width: '85%',
    marginVertical: 15,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#007bff',
  },
  tabText: {
    fontSize: 18,
    color: '#666',
    fontWeight: 'bold',
    fontFamily: KID_FONT,
  },
  activeTabText: {
    color: '#007bff',
  },
  leaderboardBody: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
  },
  leaderboardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '90%',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  leaderboardLabel: {
    fontSize: 20,
    color: '#333',
    fontFamily: KID_FONT,
  },
  leaderboardValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#007bff',
    fontFamily: KID_FONT,
  },
  scoreDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    width: '100%',
  },
  rankText: {
    width: 40,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    fontFamily: KID_FONT,
  },
  nameText: {
    flex: 1,
    fontSize: 18,
    color: '#333',
    fontFamily: KID_FONT,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007bff',
    fontFamily: KID_FONT,
  },
  dateText: {
    fontSize: 12,
    color: '#999',
    marginLeft: 40,
    marginTop: -2,
    fontFamily: KID_FONT,
  },
  nicknameInput: {
    backgroundColor: '#fff',
    padding: 12,
    fontSize: 20,
    fontFamily: KID_FONT,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ddd',
    color: '#333',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  statusText: {
    fontSize: 18,
    fontFamily: KID_FONT,
    color: '#666',
  },
  operationsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  opBadge: {
    backgroundColor: '#eee',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    margin: 5,
    minWidth: 50,
    alignItems: 'center',
  },
  opBadgeActive: {
    backgroundColor: '#007bff',
  },
  opBadgeText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  opBadgeTextActive: {
    color: '#fff',
  },
  miniLeaderboard: {
    marginTop: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    padding: 10,
    borderRadius: 10,
  },
  miniLeaderboardText: {
    fontSize: 14,
    fontFamily: KID_FONT,
    color: '#333',
  },
  statusBadgeText: {
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: KID_FONT,
  },
  rankBadge: {
    position: 'absolute',
    bottom: 20,
    backgroundColor: 'rgba(0, 123, 255, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  rankBadgeText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: KID_FONT,
  },
  streakContainer: {
    marginRight: 15,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  streakText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FF4500', // OrangeRed for the fire
    fontFamily: KID_FONT,
  },
  statsDashboard: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginVertical: 20,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 15,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#007bff',
    fontFamily: KID_FONT,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    fontFamily: KID_FONT,
  },
  analysisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginVertical: 5,
  },
  analysisLabel: {
    fontSize: 16,
    fontFamily: KID_FONT,
    color: '#333',
  },
  analysisValue: {
    fontSize: 16,
    fontFamily: KID_FONT,
    color: '#007bff',
    fontWeight: 'bold',
  },
  mistakeRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 15,
    marginBottom: 10,
    alignItems: 'center',
    borderLeftWidth: 5,
    borderLeftColor: 'red',
  },
  mistakeQuestion: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: KID_FONT,
    color: '#333',
  },
  mistakeUserAnswer: {
    fontSize: 14,
    color: '#666',
    fontFamily: KID_FONT,
  },
  mistakeTime: {
    fontSize: 14,
    color: '#999',
    fontFamily: KID_FONT,
  },
});