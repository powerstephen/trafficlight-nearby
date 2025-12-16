import React, { useEffect, useState } from "react";
import { Alert, Button, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

type MatchRow = {
  id: string | number;
  user_a: string;
  user_b: string;
  created_at: string;
};

export default function ChatsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  function showName(id: string) {
    return nameMap[id] || id.slice(0, 6);
  }

  function otherUser(m: MatchRow) {
    if (!userId) return null;
    return m.user_a === userId ? m.user_b : m.user_a;
  }

  async function loadNames(ids: string[]) {
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (unique.length === 0) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", unique);

    if (error) return;

    const next: Record<string, string> = {};
    (data ?? []).forEach((p: any) => {
      next[p.id] = p.display_name || p.id.slice(0, 6);
    });

    setNameMap((prev) => ({ ...prev, ...next }));
  }

  async function refresh() {
    if (!userId) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("matches")
        .select("id, user_a, user_b, created_at")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as MatchRow[];
      setMatches(rows);

      const ids = rows.flatMap((m) => [m.user_a, m.user_b]);
      await loadNames(ids);
    } catch (e: any) {
      Alert.alert("Chats load failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16, justifyContent: "center" }}>
        <Text>Not signed in.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Chats</Text>

      <Button title={loading ? "Loading..." : "Refresh"} onPress={refresh} disabled={loading} />

      {matches.length === 0 ? (
        <Text style={{ opacity: 0.7 }}>No matches yet.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {matches.map((m) => {
            const other = otherUser(m);
            return (
              <View
                key={String(m.id)}
                style={{ borderWidth: 1, padding: 12, borderRadius: 12, gap: 8 }}
              >
                <Text style={{ fontWeight: "700" }}>
                  {other ? showName(other) : "Unknown"}
                </Text>
                <Button
                  title="Open chat"
                  onPress={() => router.push(`/chat/${String(m.id)}`)}
                  disabled={loading}
                />
              </View>
            );
          })}
        </View>
      )}
    </SafeAreaView>
  );
}
