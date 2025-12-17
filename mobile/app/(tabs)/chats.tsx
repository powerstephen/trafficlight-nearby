import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { AppButton, Card, H1, H2, Muted, Pill, Screen } from "../../ui/components";

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

  async function refresh(silent = false) {
    if (!userId) return;
    if (!silent) setLoading(true);

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
      if (!silent) Alert.alert("Chats load failed", e?.message ?? String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Realtime: refresh when matches change for either side
  useEffect(() => {
    if (!userId) return;

    const chA = supabase
      .channel(`matches:user_a:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `user_a=eq.${userId}` },
        () => refresh(true)
      )
      .subscribe();

    const chB = supabase
      .channel(`matches:user_b:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `user_b=eq.${userId}` },
        () => refresh(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chA);
      supabase.removeChannel(chB);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Muted>Not signed in.</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <H1>Chats</H1>
        <Muted>Your matches and conversations.</Muted>
      </View>

      <AppButton
        title={loading ? "Refreshing..." : "Refresh"}
        onPress={() => refresh()}
        disabled={loading}
        variant="secondary"
      />

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <H2>Matches</H2>
          <Pill text={`${matches.length}`} tone={matches.length ? "green" : "neutral"} />
        </View>

        {matches.length === 0 ? (
          <Muted>No matches yet. Accept a request to start chatting.</Muted>
        ) : (
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
            {matches.map((m) => {
              const other = otherUser(m);
              const title = other ? showName(other) : "Unknown";
              return (
                <Pressable
                  key={String(m.id)}
                  onPress={() => router.push(`/chat/${String(m.id)}`)}
                  style={{
                    borderWidth: 1,
                    borderRadius: 14,
                    padding: 12,
                    gap: 6,
                  }}
                >
                  <H2>{title}</H2>
                  <Muted>Tap to open chat</Muted>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Card>
    </Screen>
  );
}
