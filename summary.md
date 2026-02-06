# MathlyAddicted App Summary

**MathlyAddicted** is a fast-paced, educational React Native mobile application developed using Expo. It is designed to help users improve their mental math skills through engaging gameplay and competitive features.

## Core Features
*   **Game Modes:** Supports various operations including Addition, Subtraction, Multiplication, Division, Squaring, and Square Roots. Users can play specific modes or a combined "All Operations" challenge.
*   **Gameplay Mechanics:**
    *   **Timed Challenges:** Players must solve math problems before a collapsing circle timer runs out.
    *   **Combo System:** Correct answers build combos, leading to higher points and visual rewards like "Rainbow" borders.
    *   **Strike System:** In normal mode, players have three strikes before the game ends.
    *   **Zen Mode:** A relaxed mode without timers or strikes for stress-free practice.
*   **Multiplayer:** Includes a real-time multiplayer service where users can create or join rooms using 8-character codes to compete against friends.
*   **Leaderboards & Stats:**
    *   Tracks high scores locally and supports global/local leaderboards.
    *   Provides detailed "Game Over" summaries, including speed analysis and mistake reviews.
    *   Tracks daily play time, problems solved, and maintenance of a "Streak" system with push notification reminders.

## Accessibility & Customization
*   **Safety Mode:** Reduces motion and disables flashing lights.
*   **Customization:** Allows users to set specific number ranges (min/max), toggle negative numbers, and allow/disallow zero.
*   **Ad Integration:** Integrated with Google Mobile Ads (Banner and Interstitial ads).

## Technical Stack
*   **Frontend:** React Native with Expo and `react-native-paper` for UI components.
*   **State Management:** React Hooks (`useState`, `useEffect`, `useMemo`, `useRef`).
*   **Storage:** `AsyncStorage` for local stats, high scores, and saving game progress.
*   **Backend/Services:** Real-time multiplayer synchronization, Firebase configuration, and profanity filtering.
*   **Media:** `expo-av` for sound effects and `Animated` API for dynamic background visuals.
