import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { AppButton, Card, H1, Muted, Screen, TextField } from "../ui/components";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function signUp() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      Alert.alert("Signed up", "Now sign in.");
    } catch (e: any) {
      Alert.alert("Sign up failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function signIn() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/(tabs)/nearby");
    } catch (e: any) {
      Alert.alert("Sign in failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={{ justifyContent: "center" }}>
      <View style={{ gap: 10 }}>
        <H1>TrafficLight</H1>
        <Muted>Sign in to share your status and connect nearby.</Muted>
      </View>

      <Card style={{ gap: 14 }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
        />

        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />

        <View style={{ gap: 10, marginTop: 6 }}>
          <AppButton title={loading ? "Signing in..." : "Sign In"} onPress={signIn} disabled={loading} />
          <AppButton title={loading ? "Signing up..." : "Create Account"} onPress={signUp} disabled={loading} variant="secondary" />
        </View>
      </Card>
    </Screen>
  );
}
