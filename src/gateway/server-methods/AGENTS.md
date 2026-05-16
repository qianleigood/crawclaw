# Gateway Server Methods Notes

- Session transcripts are a `parentId` chain/DAG; never append `type: "message"` entries without a `parentId` field. Use the local transcript helpers so injected gateway messages stay attached to the current leaf.
