import React, { useEffect, useState } from "react";
import { Alert, Button, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

type RequestRow = {
  id: string | number;
  from_user: string;
  to_user: string;
  status: string;
  created_at: string;
  responded_at: string | null;
};

export default function RequestsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(false);
  const [incoming, setIncoming] = useState<RequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<RequestRow[]>([]);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  function showName(id: string) {
    return nameMap[id] || id.slice(0, 6);
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
      const { data: reqs, error } = await supabase
        .from("connect_requests")
        .select("id, from_user, to_user, status, created_at, responded_at")
        .or(`from_user.eq.${userId},to_user.eq.${userId}`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const all = (reqs ?? []) as RequestRow[];
      setIncoming(all.filter((r) => r.to_user === userId && r.status === "pending"));
      setOutgoing(all.filter((r) => r.from_user === userId && r.status === "pending"));
      await loadNames(all.flatMap((r) => [r.from_user, r.to_user]));
    } catch (e: any) {
      Alert.alert("Load error", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function orderedPair(a: string, b: string) {
    return a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a };
  }

  async function acceptRequest(req: RequestRow) {
    if (!userId) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { error: upErr } = await supabase
        .from("connect_requests")
        .update({ status: "accepted", responded_at: nowIso })
        .eq("id", req.id);

      if (upErr) throw upErr;

      const pair = orderedPair(req.from_user, req.to_user);

      // matches.request_id is NOT NULL in your setup, so include it.
      const { error: mErr } = await supabase.from("matches").insert({
        request_id: String(req.id),
        user_a: pair.user_a,
        user_b: pair.user_b,
      });

      if (mErr && String(mErr.code) !== "23505") throw mErr;

      Alert.alert("Matched", "Request accepted.");
      await refresh();
    } catch (e: any) {
      Alert.alert("Accept failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function declineRequest(req: RequestRow) {
    if (!userId) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("connect_requests")
        .update({ status: "declined", responded_at: nowIso })
        .eq("id", req.id);

      if (error) throw error;

      Alert.alert("Declined", "Request declined.");
      await refresh();
    } catch (e: any) {
      Alert.alert("Decline failed", e?.message ?? String(e));
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
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Requests</Text>

      <Button title={loading ? "Loading..." : "Refresh"} onPress={refresh} disabled={loading} />

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Incoming</Text>
        {incoming.length === 0 ? (
          <Text style={{ opacity: 0.7 }}>No incoming requests.</Text>
        ) : (
          incoming.map((r) => (
            <View key={String(r.id)} style={{ borderWidth: 1, padding: 10, borderRadius: 10, gap: 8 }}>
              <Text>From: {showName(r.from_user)}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button title="Accept" onPress={() => acceptRequest(r)} disabled={loading} />
                <Button title="Decline" onPress={() => declineRequest(r)} disabled={loading} />
              </View>
            </View>
          ))
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 16, fontWeight: "700" }}>Outgoing</Text>
        {outgoing.length === 0 ? (
          <Text style={{ opacity: 0.7 }}>No outgoing pending requests.</Text>
        ) : (
          outgoing.map((r) => (
            <View key={String(r.id)} style={{ borderWidth: 1, padding: 10, borderRadius: 10, gap: 6 }}>
              <Text>To: {showName(r.to_user)}</Text>
              <Text style={{ opacity: 0.7 }}>Status: {r.status}</Text>
            </View>
          ))
        )}
      </View>
    </SafeAreaView>
  );
}
