import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { Welcome } from '../components/Welcome';
import { AuthProvider, useAuth } from '../lib/auth';
import { ToastProvider } from '../lib/feedback';
import { LocationProvider } from '../lib/location';
import { colors } from '../lib/theme';

function Gate() {
  const { loading, user } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!user) return <Welcome />;
  return (
    <LocationProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="place/[id]" options={{ title: '地点' }} />
      </Stack>
    </LocationProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <StatusBar style="light" />
        <Gate />
      </ToastProvider>
    </AuthProvider>
  );
}
