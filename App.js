import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SafeAreaView, StyleSheet, Text, View, TouchableOpacity, Alert, BackHandler, Animated, Dimensions, StatusBar, Switch, Platform } from 'react-native';
import { Provider as PaperProvider, Appbar, useTheme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('screen');
const BORDER_WIDTH = 15;
const CORNER_RADIUS = 50; 
const INNER_RADIUS = CORNER_RADIUS - BORDER_WIDTH;

const operations = ['+', '-', '*', '/'];

const KID_FONT = Platform.OS === 'ios' ? 'Chalkboard SE' : 'sans-serif-medium';
const SYSTEM_FONT = Platform.OS === 'ios' ? 'System' : 'sans-serif';

const DriftingOperator = ({ char, size, opacity, rotation }) => {
  const moveAnim = useRef(new Animated.ValueXY({
    x: Math.random() * SCREEN_WIDTH,
    y: Math.random() * SCREEN_HEIGHT
  })).current;

  useEffect(() => {
    const move = () => {
      Animated.timing(moveAnim, {
        toValue: {
          x: Math.random() * SCREEN_WIDTH,
          y: Math.random() * SCREEN_HEIGHT
        },
        duration: 15000 + Math.random() * 10000,
        useNativeDriver: true,
      }).start(() => move());
    };
    move();
  }, []);

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
        color: '#000',
        fontWeight: 'bold',
      }}
    >
      {char}
    </Animated.Text>
  );
};

const MathBackground = () => {
  const operators = useMemo(() => {
    const ops = ['+', '-', '×', '÷', '=', '√', 'π', '%'];
    return Array.from({ length: 20 }).map((_, i) => ({
      id: i,
      char: ops[Math.floor(Math.random() * ops.length)],
      size: Math.random() * 20 + 20,
      opacity: Math.random() * 0.1 + 0.05,
      rotation: Math.random() * 360 + 'deg',
    }));
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      {operators.map((op) => (
        <DriftingOperator key={op.id} {...op} />
      ))}
    </View>
  );
};

const generateQuestion = (selectedOperations) => {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const op = selectedOperations[Math.floor(Math.random() * selectedOperations.length)];

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
      question = `${num1 * num2} / ${num1}`;
      answer = num2;
      break;
  }
  return { question, answer };
};

const CollapsingCircleTimer = ({ timerAnim }) => {
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
}) => {
  const colorAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const isRainbowActive = useRef(false);

  useEffect(() => {
    Animated.spring(progressAnim, {
      toValue: Math.min(combo / 21, 1),
      useNativeDriver: false,
    }).start();

    if (combo > 20) {
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
  }, [combo]);

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
          <Appbar.Header style={{ width: '100%', backgroundColor: 'transparent' }}>
            <Appbar.Content title="" />
            <View style={styles.highScoreContainer}>
              <Text style={styles.highScoreText}>Best: {highScore}</Text>
            </View>
            <Appbar.Action icon="exit-to-app" onPress={handleExit} />
          </Appbar.Header>
          {!isZenMode && <CollapsingCircleTimer timerAnim={timerAnim} />}
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
              {[answer - 1, answer, answer + 1].map((option, index) => (
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

const GameModes = ({ navigation, setOperations, isZenMode, setIsZenMode, savedGames, loadSavedGame }) => {
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
        <Appbar.Content title="Operation Selection!" titleStyle={{ fontFamily: KID_FONT }} />
      </Appbar.Header>
      <View style={styles.gameBody}>
        <Text style={styles.sectionHeader}>Settings</Text>
        <View style={styles.zenModeContainer}>
          <Text style={styles.zenModeText}>Zen Mode (No Timer/Strikes)</Text>
          <Switch
            value={isZenMode}
            onValueChange={setIsZenMode}
            color="#007bff"
          />
        </View>
        <View style={styles.divider} />
        <Text style={styles.sectionHeader}>Select Mode</Text>
        {[
          { label: 'Addition', op: ['+'], icon: '+', color: '#4CAF50' },
          { label: 'Subtraction', op: ['-'], icon: '-', color: '#F44336' },
          { label: 'Division', op: ['/'], icon: '÷', color: '#2196F3' },
          { label: 'Multiplication', op: ['*'], icon: '×', color: '#FF9800' },
          { label: 'All Operations!', op: ['+', '-', '*', '/'], icon: '🧠', color: '#9C27B0' },
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
         <TouchableOpacity
          style={[styles.menuButton, { marginTop: 20, backgroundColor: 'grey' }]}
          onPress={() => navigation.navigate("Menu")}
        >
          <Text style={styles.menuButtonText}>Back to Menu</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const Leaderboard = ({ navigation }) => {
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
    { label: 'All Operations!', op: '+-*/' },
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
        <Appbar.BackAction onPress={() => selectedMode ? setSelectedMode(null) : navigation.navigate("Menu")} />
        <Appbar.Content title="Leaderboard" titleStyle={{ fontFamily: KID_FONT }} />
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
    </View>
  );
};

const MainMenu = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <MathBackground />
      <Appbar.Header style={{ backgroundColor: 'transparent' }}>
        <Appbar.Content title="" />
      </Appbar.Header>
      <View style={styles.gameBody}>
        <View style={styles.titleContainer}>
          <Text style={styles.titleText}>Mathly</Text>
          <Text style={[styles.titleText, { color: '#007bff' }]}>Addicted</Text>
        </View>
        <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate("GameModes")}>
          <Text style={styles.menuButtonText}>PLAY</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton} onPress={() => navigation.navigate("Leaderboard")}>
          <Text style={styles.menuButtonText}>SCORES</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.menuButton, { backgroundColor: '#cccccc' }]} disabled>
          <Text style={styles.menuButtonText}>SETTINGS</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuButton} onPress={() => BackHandler.exitApp()}>
          <Text style={styles.menuButtonText}>QUIT</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default function App() {
  useEffect(() => {
    // Ensure the root container is transparent or matches the desired background
  }, []);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [strikes, setStrikes] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(0);
  const [timer, setTimer] = useState(5);
  const timerAnim = useRef(new Animated.Value(5)).current;
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
  const [isZenMode, setIsZenMode] = useState(false);
  const [savedGames, setSavedGames] = useState({});

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
      incorrectAnswers,
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
        setIncorrectAnswers(gameState.incorrectAnswers || []);
        
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

    if (timer === 5) {
      timerAnim.setValue(5);
      Animated.timing(timerAnim, {
        toValue: 0,
        duration: 5000,
        useNativeDriver: false,
      }).start();
    }

    if (timer === 0) {
      const currentStrikes = strikesRef.current;
      const currentScore = scoreRef.current;
      const newStrikes = currentStrikes + 1;
      const updatedIncorrect = [...incorrectAnswers, { question, answer, userChoice: 'Timed Out' }];
      setIncorrectAnswers(updatedIncorrect);

      flashAnim.setValue(0.3);
      Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start();
      setCombo(0);
      setStrikes(newStrikes);

      if (newStrikes >= 3) {
        if (currentScore > 0) {
          saveToLeaderboard(currentScore);
        }
        setIsPaused(true);
        const incorrectText = updatedIncorrect.map(item => 
          `${item.question} = ${item.answer}\n(You chose: ${item.userChoice})`
        ).join('\n\n');
        Alert.alert("Game Over", `Final Score: ${currentScore}\n\nIncorrect Answers:\n${incorrectText}`, [
          { text: "Restart", onPress: () => { setScore(0); setStrikes(0); setCombo(0); setIncorrectAnswers([]); setIsWaitingToStart(true); setIsPaused(true); startNewQuestion(); } },
          { text: "Exit", onPress: () => { setScore(0); setStrikes(0); setCombo(0); setIncorrectAnswers([]); setIsPaused(false); setScreen("Menu"); } },
        ]);
      } else { startNewQuestion(); }
    }
    const interval = setInterval(() => setTimer((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(interval);
  }, [timer, screen, isPaused, isCountingDown, isZenMode]);

  useEffect(() => {
    if (screen === 'Game') {
      setIsWaitingToStart(true);
      setIsPaused(true);
      startNewQuestion();
    }
  }, [screen]);

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
    const newQuestion = generateQuestion(selectedOperations);
    setQuestion(newQuestion.question);
    setAnswer(newQuestion.answer);
    setTimer(5);
    timerAnim.stopAnimation();
    timerAnim.setValue(5);
    setBorderColor('transparent');
  };

  const handleAnswer = (userAnswer) => {
    if (isPaused || isCountingDown) return;
    if (parseInt(userAnswer) === answer) {
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
      const newStrikes = strikes + 1;
      const updatedIncorrect = [...incorrectAnswers, { question, answer, userChoice: userAnswer }];
      setIncorrectAnswers(updatedIncorrect);

      flashAnim.setValue(0.3);
      Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start();
      setCombo(0);
      
      if (!isZenMode) {
        setStrikes(newStrikes);
        
        if (newStrikes >= 3) {
          if (score > 0) {
            saveToLeaderboard(score);
          }
          setIsPaused(true);
          const incorrectText = updatedIncorrect.map(item => 
            `${item.question} = ${item.answer}\n(You chose: ${item.userChoice})`
          ).join('\n\n');
        Alert.alert("Game Over", `Final Score: ${score}\n\nIncorrect Answers:\n${incorrectText}`, [
          { text: "Restart", onPress: () => { setScore(0); setStrikes(0); setCombo(0); setIncorrectAnswers([]); setIsWaitingToStart(true); setIsPaused(true); startNewQuestion(); } },
          { text: "Exit", onPress: () => { setScore(0); setStrikes(0); setCombo(0); setIncorrectAnswers([]); setIsPaused(false); setScreen("Menu"); } },
        ]);
        } else { startNewQuestion(); }
      } else {
        startNewQuestion();
      }
    }
  };

  const navigation = {
    navigate: (screenName) => setScreen(screenName),
    resetGame: () => { setScore(0); setStrikes(0); setCombo(0); setIncorrectAnswers([]); setIsPaused(false); },
    saveAndExit: async () => {
      if (isZenMode && score > 0) {
        await saveToLeaderboard(score);
      }
      await saveGame();
      setScreen('Menu');
    }
  };

  return (
    <PaperProvider>
      <View style={styles.container}>
        {screen === "Menu" && (
          <MainMenu
            navigation={navigation}
          />
        )}
        {screen === "GameModes" && (
          <GameModes
            navigation={navigation}
            setOperations={setSelectedOperations}
            isZenMode={isZenMode}
            setIsZenMode={setIsZenMode}
            savedGames={savedGames}
            loadSavedGame={loadSavedGame}
          />
        )}
        {screen === "Leaderboard" && (
          <Leaderboard
            navigation={navigation}
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
});
