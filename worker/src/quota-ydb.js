// YDB Document API. IAM token comes from the Cloud Functions invocation context.
// A single conditional UpdateItem protects the last slot across all instances.
export function createYdbQuotaStore({ endpoint, table = "ai_monthly_usage", token, fetcher = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.hostname !== "docapi.serverless.yandexcloud.net" || url.username || url.password || url.search || url.hash || !token) {
    throw new Error("Invalid quota configuration");
  }
  async function call(action, payload) {
    const response = await fetcher(url.href, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(4000),
      headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": `DynamoDB_20120810.${action}`,
      },
      body: JSON.stringify({ TableName: table, ...payload }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 400 && String(data.__type || "").split("#").pop() === "ConditionalCheckFailedException") return null;
      throw new Error("Quota storage unavailable");
    }
    return data;
  }
  const key = (uid, period) => ({ uid: { S: uid }, period: { S: period } });
  function count(item) {
    const value = item?.used?.N;
    if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid quota counter");
    return Number(value);
  }
  return {
    async read(uid, period) {
      const data = await call("GetItem", { Key: key(uid, period), ConsistentRead: true });
      if (!data) throw new Error("Quota read failed");
      return data.Item ? count(data.Item) : 0;
    },
    async consume(uid, period, limit) {
      const data = await call("UpdateItem", {
        Key: key(uid, period),
        UpdateExpression: "SET #used = if_not_exists(#used, :zero) + :one",
        ConditionExpression: "attribute_not_exists(#used) OR #used < :limit",
        ExpressionAttributeNames: { "#used": "used" },
        ExpressionAttributeValues: { ":zero": { N: "0" }, ":one": { N: "1" }, ":limit": { N: String(limit) } },
        ReturnValues: "ALL_NEW",
      });
      return data === null ? null : count(data.Attributes);
    },
  };
}
