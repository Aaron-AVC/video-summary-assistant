# Rejected unsupported-exclusion draft

This snapshot preserves the pre-final worktree version of the unversioned
`distribution-scope.json` and `notice-preview/` paths. It recorded 12 npm
identities as `CONFIRMED_EXCLUDED` solely because the same-build Parcel graph
had no matching package asset. That absence did not establish exclusion.
The resulting preview contained 26 files and omitted notices for those
identities.

This draft was not adopted. The active versioned v3 scope keeps those 12
identities `UNKNOWN` and includes their verified license texts in its
31-file preview. The archived draft is retained for audit history only.
