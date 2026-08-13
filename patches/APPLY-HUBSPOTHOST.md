# Apply Print Operations Tools integration

This agent cannot push to `usercondition/HubSpotHost` (GitHub 403 for cursor bot). Apply the patch in that repo:

```bash
cd HubSpotHost
git checkout -b cursor/pricing-matrix-tool-825c
git am /path/to/TabletopPricingMatrix/patches/hubspothost-pricing-matrix-tool.patch
# or: git apply patches/hubspothost-pricing-matrix-tool.patch
git push -u origin HEAD
```

Then on the Print Operations Railway service set:

```text
PRICING_MATRIX_URL=https://<tabletop-pricing-matrix>.up.railway.app
```

A **Price** item appears under sidebar **Tools** and opens the quote generator.
