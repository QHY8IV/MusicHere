import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { Loading } from '../components/ui';
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
        <Loading />
      </View>
    );
  }
  if (!user) return <Welcome />;
  return (
    <LocationProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="place/[id]" />
      </Stack>
    </LocationProvider>
  );
}

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AuthProvider>
        <ToastProvider>
          <StatusBar style="light" />
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </View>
  );
}
