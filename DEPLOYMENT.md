# Deployment Guide - CrisisLens v2.0

## Pre-Deployment Checklist

- [ ] Clone repository and run `npm install`
- [ ] Create Google Cloud Project with billing enabled
- [ ] Enable required APIs
- [ ] Create Firestore database
- [ ] Add API keys to Secret Manager
- [ ] Configure Cloud Build permissions
- [ ] Update `cloudbuild.yaml` with project ID

## Step-by-Step Deployment

### 1. Environment Setup

```bash
# Set your Google Cloud Project ID
export PROJECT_ID="your-project-id"
export REGION="europe-west1"

# Authenticate with Google Cloud
gcloud auth login
gcloud config set project $PROJECT_ID
```

### 2. Enable Required Services

```bash
gcloud services enable run.googleapis.com cloudlogging.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
```

### 3. Create Firestore Database

```bash
# First time only - create Firestore database in your region
gcloud firestore databases create --region=$REGION
```

### 4. Create Google Cloud Secrets

```bash
# Get your Gemini API Key from https://ai.google.dev/
read -p "Enter GEMINI_API_KEY: " GEMINI_API_KEY
echo -n "$GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=-
```

### 5. Grant Cloud Build Permissions

```bash
# Get your Cloud Build service account number
BUILD_SA=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')@cloudbuild.gserviceaccount.com

# Grant Secret Accessor role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$BUILD_SA \
  --role=roles/secretmanager.secretAccessor

# Grant Firestore admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$BUILD_SA \
  --role=roles/datastore.admin

# Grant Cloud Run admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$BUILD_SA \
  --role=roles/run.admin

# Grant Service Account User role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$BUILD_SA \
  --role=roles/iam.serviceAccountUser
```

### 6. Deploy via Cloud Build

```bash
# Submit the build (automatic deployment)
gcloud builds submit --config=cloudbuild.yaml

# Monitor the build
gcloud builds log --stream

# Check deployment status
gcloud run services list
```

### 7. Verify Deployment

```bash
# Get your service URL
SERVICE_URL=$(gcloud run services describe crisis-lens --region=$REGION --format='value(status.url)')

# Test health endpoint
curl $SERVICE_URL/health

# Get statistics (requires admin key)
curl -H "x-admin-key: YOUR_ADMIN_KEY" $SERVICE_URL/api/stats

# Visit in browser
echo "Open your browser: $SERVICE_URL"
```

## Troubleshooting

### Build Fails
```bash
# Check build logs
gcloud builds log BUILD_ID

# Check container registry
gcloud container images list

# Delete failed builds
gcloud builds cancel BUILD_ID
```

### Service Won't Start
```bash
# Check Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=crisis-lens" --limit=50

# Check service details
gcloud run services describe crisis-lens --region=$REGION

# Restart service
gcloud run services update crisis-lens --region=$REGION
```

### Secret Access Issues
```bash
# Verify secrets exist
gcloud secrets list

# Check secret content (first 100 chars)
gcloud secrets versions access latest --secret=GEMINI_API_KEY

# Re-create secret if needed
gcloud secrets delete GEMINI_API_KEY
echo -n "new-key" | gcloud secrets create GEMINI_API_KEY --data-file=-
```

### Firestore Issues
```bash
# Check Firestore status
gcloud firestore databases describe

# List collections
gcloud firestore databases list

# Verify indexes
gcloud firestore indexes list
```

## Performance Optimization

### Scale Configuration

Edit `cloudbuild.yaml` `--max-instances` and `--memory`:

```yaml
- '--memory=512Mi'              # Memory per instance
- '--cpu=1'                     # CPU per instance
- '--max-instances=100'         # Maximum instances
- '--min-instances=0'           # Minimum instances (0 for cost savings)
- '--concurrency=80'            # Max concurrent requests
```

**Recommendations:**
- Development: `256Mi`, `min-instances=0`, `max-instances=10`
- Production: `512Mi`, `min-instances=1`, `max-instances=100`

### Cost Monitoring

```bash
# Enable billing alerts
gcloud billing budgets create \
  --display-name "Crisis Lens Budget" \
  --budget-amount 50 \
  --threshold-rule percent=100

# Monitor costs
gcloud billing budgets list
gcloud billing accounts list
```

## Rollback Procedures

### Rollback to Previous Version
```bash
# View deployment history
gcloud run deployments list --service=crisis-lens

# Rollback to specific revision
gcloud run services update crisis-lens \
  --region=$REGION \
  --revision=REVISION_ID

# Or revert to last good build
gcloud builds cancel  # Cancel current
gcloud builds submit # Re-submit previous build
```

## Monitoring & Logging

### View Logs
```bash
# Real-time logs
gcloud logging read "resource.type=cloud_run_revision" --stream --limit=50

# Filter by severity
gcloud logging read "resource.type=cloud_run_revision AND severity=ERROR" --limit=20

# Export to BigQuery (optional)
gcloud logging sinks create crisis-lens-sink bigquery.googleapis.com/projects/$PROJECT_ID/datasets/logs
```

### Set Up Alerts
```bash
# Create alert policy (via Cloud Console)
# URL: https://console.cloud.google.com/monitoring/alerting/policies
```

## Security Hardening

### Additional Steps
```bash
# Require authentication (optional)
gcloud run services update crisis-lens \
  --region=$REGION \
  --no-allow-unauthenticated \
  --add-cloudsql-instances=INSTANCE_CONNECTION_NAME

# Set domain restrictions
gcloud run services update crisis-lens \
  --region=$REGION \
  --update-env-vars=ALLOWED_ORIGINS="https://yourdomain.com"

# Enable custom domain
gcloud run domain-mappings create \
  --service=crisis-lens \
  --domain=yourdomain.com \
  --region=$REGION
```

## Update Deployment

```bash
# Make code changes
# Update files locally

# Re-deploy
git add .
git commit -m "Update: description"
git push origin main

# Trigger build (if using Cloud Build triggers)
# OR manually:
gcloud builds submit --config=cloudbuild.yaml
```

## Maintenance

### Regular Tasks
```bash
# Weekly: Check logs for errors
gcloud logging read "severity=ERROR" --limit=100

# Monthly: Review statistics
curl -H "x-admin-key: $ADMIN_KEY" $SERVICE_URL/api/stats

# Quarterly: Update dependencies
npm update
npm audit fix
gcloud builds submit

# Annual: Security audit
gcloud iam service-accounts list
gcloud projects get-iam-policy $PROJECT_ID
```

## Cost Estimates

Typical monthly costs (approximate):
- Cloud Run: $5-15 (depends on traffic)
- Firestore: $1-10 (depends on reads/writes)
- Cloud Logging: Free (1GB/month)
- Cloud Build: Free (120 free minutes/day)
- **Total: ~$10-25/month**

See [Cloud Pricing Calculator](https://cloud.google.com/products/calculator)

## Support

For issues:
1. Check logs: `gcloud logging read --limit=50`
2. Check service status: `gcloud run services describe crisis-lens`
3. Review [Cloud Run Docs](https://cloud.google.com/run/docs)
4. Check [Firestore Docs](https://cloud.google.com/firestore/docs)

---

**Successfully deployed to:** https://crisis-lens-REGION-PROJECT.run.app/
