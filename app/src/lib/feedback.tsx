import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, radius } from './theme';

interface ToastState {
  show: (message: string, tone?: 'ok' | 'error') => void;
}

const ToastContext = createContext<ToastState | null>(null);

/** 全局轻提示。Alert 在 web 上不支持多按钮，所以反馈统一走这里。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error'; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: 'ok' | 'error' = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <View pointerEvents="none" style={styles.wrap}>
          <View style={[styles.toast, toast.tone === 'error' && styles.error]} accessibilityLiveRegion="polite">
            <Text style={styles.text} testID="toast">{toast.message}</Text>
          </View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}

export function confirmAction(title: string, message: string, confirmText = '确定'): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, top: 56, alignItems: 'center' },
  toast: {
    backgroundColor: colors.surface3,
    borderColor: `${colors.lime}88`,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    paddingVertical: 11,
    maxWidth: 480,
  },
  error: { borderColor: `${colors.red}AA` },
  text: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
