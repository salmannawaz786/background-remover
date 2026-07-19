# Oracle Cloud Instance Setup - Step by Step Guide

This guide will walk you through creating an Oracle Cloud instance with 24GB RAM and 4 vCPUs (or the Always Free tier ARM instances).

## 🎯 Overview

You have two options:

**Option 1: Always Free Tier (Recommended for Payasugo users)**
- 4 ARM-based Ampere A1 cores
- 24GB RAM total (across up to 4 VMs)
- **100% FREE forever**

**Option 2: Paid Tier**
- VM.Standard.E2.4 (4 vCPUs, 32GB RAM)
- ~$36/month

## 📋 Prerequisites

Before you start:
- [ ] Oracle Cloud account (sign up at https://cloud.oracle.com)
- [ ] Credit card (for identity verification, won't be charged on free tier)
- [ ] Email address
- [ ] Phone number

---

## 🚀 Step 1: Create Oracle Cloud Account

### 1.1 Sign Up

1. Go to: **https://cloud.oracle.com**
2. Click **"Try Oracle Cloud Free Tier"** or **"Sign In"**
3. Select your **Country/Territory**
4. Enter your **Email Address**
5. Click **"Verify my email"**

### 1.2 Verify Email

1. Check your email for verification code
2. Enter the code
3. Click **"Continue"**

### 1.3 Account Details

1. **Cloud Account Name**: Choose a unique name (e.g., `mybg-remover-cloud`)
   - This becomes your tenancy name
   - Cannot be changed later
2. **Home Region**: Choose closest to your users
   - Examples: US East (Ashburn), US West (Phoenix), UK South (London)
   - **IMPORTANT**: Cannot be changed later!
3. Click **"Continue"**

### 1.4 Personal Information

1. Enter your details:
   - First Name
   - Last Name
   - Address
   - Phone Number
2. Enter payment information (for identity verification)
   - Credit card required but won't be charged on free tier
   - You'll get a notice before any charges
3. Agree to terms and conditions
4. Click **"Start my free trial"** or **"Complete Sign-Up"**

### 1.5 Wait for Provisioning

- Takes 2-5 minutes
- You'll receive an email when ready
- Your tenancy is being set up

---

## 🖥️ Step 2: Create Compute Instance

### 2.1 Log In to Console

1. Go to: **https://cloud.oracle.com**
2. Enter your **Cloud Account Name** (from Step 1.3)
3. Click **"Next"**
4. Enter your **Username** (your email)
5. Enter your **Password**
6. Click **"Sign In"**

### 2.2 Navigate to Compute

1. In Oracle Cloud Console, click the **☰ (hamburger menu)** in top-left
2. Navigate to: **Compute** → **Instances**
3. Click **"Create Instance"**

---

## ⚙️ Step 3: Configure Your Instance

### 3.1 Name and Placement

**Name your instance:**
```
Name: bg-remover-api
```

**Placement:**
- Leave as default (your home region)
- Availability Domain: Leave as default

### 3.2 Image and Shape

#### Choose Image

1. In **Image and shape** section, click **"Change Image"**
2. Select **"Canonical Ubuntu"**
3. Choose **"22.04"** (or latest LTS)
4. Click **"Select Image"**

#### Choose Shape (This is important!)

**For Always Free Tier (ARM - Recommended):**

1. Click **"Change Shape"**
2. Select **"Ampere"** (ARM-based)
3. Select **"VM.Standard.A1.Flex"**
4. Configure:
   - **Number of OCPUs**: `4` (or 2-4, your choice)
   - **Amount of memory (GB)**: `24` (or 16-24)
5. Click **"Select Shape"**

**For Paid Tier (x86):**

1. Click **"Change Shape"**
2. Select **"Specialty and previous generation"**
3. Select **"VM.Standard.E2.4"**
   - 4 OCPUs
   - 32 GB memory
   - ~$36/month
4. Click **"Select Shape"**

### 3.3 Networking

**Primary VNIC information:**

1. **Virtual cloud network**: 
   - If you have one, select it
   - Otherwise, select **"Create new virtual cloud network"**
   
2. **Subnet**:
   - If creating new VCN, select **"Create new public subnet"**
   - Otherwise, select your public subnet

3. **Public IP address**:
   - ✅ **Select "Assign a public IPv4 address"** (IMPORTANT!)

4. Leave other options as default

### 3.4 Add SSH Keys

**Option A: Generate New Key (Recommended for beginners)**

1. Select **"Generate a key pair for me"**
2. Click **"Save Private Key"**
   - Saves as `.key` file
   - **IMPORTANT**: Save this securely! You need it to access your server
3. Click **"Save Public Key"** (optional, for reference)

**Option B: Upload Your Own Key (If you have one)**

1. Select **"Upload public key files (.pub)"**
2. Click **"Choose files"**
3. Upload your `.pub` file

**Option C: Paste Public Key**

1. Select **"Paste public keys"**
2. Paste your SSH public key

### 3.5 Boot Volume

1. **Boot volume**: Leave as default
2. **Boot volume size (GB)**: 
   - Default is 47GB
   - Recommended: **100GB** or more
   - Click **"Specify a custom boot volume size"**
   - Enter: `100`

### 3.6 Review and Create

1. Scroll down to review all settings:
   ```
   ✓ Name: bg-remover-api
   ✓ Image: Ubuntu 22.04
   ✓ Shape: VM.Standard.A1.Flex (4 OCPU, 24GB RAM)
   ✓ VCN: Created/Selected
   ✓ Public IP: Yes
   ✓ SSH Key: Added
   ✓ Boot volume: 100GB
   ```

2. Click **"Create"** button at the bottom

### 3.7 Wait for Provisioning

- Status shows: **PROVISIONING** (orange)
- Takes 2-5 minutes
- Status changes to: **RUNNING** (green)

---

## 🔐 Step 4: Configure Security (Firewall Rules)

### 4.1 Get Instance Details

1. Wait for instance status: **RUNNING** (green)
2. Note down your **Public IP Address**
   - Example: `150.230.45.123`
   - You'll need this to SSH and access your API

### 4.2 Configure Security List (Ingress Rules)

1. On your instance page, under **Instance information**
2. Click on your **Virtual cloud network** link
3. In left sidebar, click **"Security Lists"**
4. Click on **"Default Security List"** (or your security list)

### 4.3 Add Ingress Rules

Click **"Add Ingress Rules"** and add these THREE rules:

**Rule 1: HTTP (Port 80)**
```
Source CIDR: 0.0.0.0/0
IP Protocol: TCP
Source Port Range: All
Destination Port Range: 80
Description: HTTP traffic
```
Click **"Add Ingress Rules"**

**Rule 2: HTTPS (Port 443)**
```
Source CIDR: 0.0.0.0/0
IP Protocol: TCP
Source Port Range: All
Destination Port Range: 443
Description: HTTPS traffic
```
Click **"Add Ingress Rules"**

**Rule 3: SSH (Port 22)** - Should already exist
```
Source CIDR: 0.0.0.0/0
IP Protocol: TCP
Source Port Range: All
Destination Port Range: 22
Description: SSH
```
If not present, add it.

**Your Security List should now have:**
- ✅ Port 22 (SSH)
- ✅ Port 80 (HTTP)
- ✅ Port 443 (HTTPS)

---

## 🔑 Step 5: Connect to Your Instance

### 5.1 Get Connection Details

From your instance page:
- **Public IP**: `150.230.45.123` (your actual IP)
- **Username**: `ubuntu` (for Ubuntu images)
- **SSH Key**: The `.key` file you downloaded

### 5.2 Connect via SSH

**On Windows (PowerShell or Command Prompt):**

```powershell
# Navigate to where you saved the key
cd C:\Users\YourName\Downloads

# Set key permissions (PowerShell)
icacls bg-remover-api.key /inheritance:r
icacls bg-remover-api.key /grant:r "%USERNAME%:R"

# Connect (replace with your IP)
ssh -i bg-remover-api.key ubuntu@150.230.45.123
```

**On Windows (using PuTTY):**

1. Download PuTTYgen: https://www.putty.org
2. Open PuTTYgen
3. Click **"Load"**
4. Select your `.key` file
5. Click **"Save private key"** (saves as `.ppk`)
6. Open PuTTY
7. Enter:
   - Host Name: `ubuntu@150.230.45.123`
   - Port: `22`
8. In left sidebar: **Connection** → **SSH** → **Auth**
9. Browse and select your `.ppk` file
10. Click **"Open"**

**On Mac/Linux:**

```bash
# Navigate to where you saved the key
cd ~/Downloads

# Set key permissions
chmod 400 bg-remover-api.key

# Connect (replace with your IP)
ssh -i bg-remover-api.key ubuntu@150.230.45.123
```

### 5.3 First Connection

1. You'll see a message: "Are you sure you want to continue connecting?"
2. Type: `yes` and press Enter
3. You should now be connected!

```
ubuntu@bg-remover-api:~$
```

**You're in!** 🎉

---

## ✅ Step 6: Verify Instance

### 6.1 Check System Resources

```bash
# Check CPU
nproc
# Should show: 4

# Check RAM
free -h
# Should show: ~24GB total

# Check disk
df -h
# Should show: ~100GB for /

# Check OS
lsb_release -a
# Should show: Ubuntu 22.04
```

### 6.2 Update System

```bash
sudo apt-get update
sudo apt-get upgrade -y
```

This takes 2-3 minutes.

---

## 🎯 Step 7: Ready for Deployment!

Your instance is now ready! You have:

✅ Oracle Cloud instance running  
✅ Ubuntu 22.04 installed  
✅ 24GB RAM / 4 vCPUs  
✅ 100GB storage  
✅ Public IP address  
✅ SSH access working  
✅ Firewall configured (ports 22, 80, 443)  
✅ System updated  

### What's Next?

Now you can deploy your background remover:

```bash
# Clone repository
git clone https://github.com/yourusername/background-remover.git
cd background-remover/oracle-deploy

# Run setup script
sudo chmod +x setup-oracle.sh
sudo ./setup-oracle.sh

# Configure environment
cp .env.example .env
nano .env  # Add your Firebase & R2 credentials

# Deploy!
chmod +x deploy.sh
./deploy.sh
```

**→ Full deployment guide**: [QUICK_START.md](QUICK_START.md)

---

## 🔧 Troubleshooting

### Can't Create Always Free Instance

**Error**: "Out of capacity for shape VM.Standard.A1.Flex"

**Solutions**:
1. **Try different availability domain**:
   - When creating instance, expand "Show advanced options"
   - Try different availability domain (AD-1, AD-2, AD-3)
   
2. **Try different region**:
   - Top-right corner, click your region name
   - Select different region
   - Try creating instance again
   - Popular regions: Phoenix, Ashburn, London

3. **Try at different time**:
   - Free tier capacity limited
   - Try during off-peak hours (early morning)
   
4. **Reduce specs temporarily**:
   - Start with 2 OCPU, 12GB RAM
   - Scale up later if needed

### Can't Connect via SSH

**Issue**: "Connection refused" or "Permission denied"

**Solutions**:
1. **Check key permissions** (should be 400):
   ```bash
   chmod 400 your-key.key
   ```

2. **Use correct username**:
   - Ubuntu images: `ubuntu`
   - Oracle Linux: `opc`

3. **Check Security List**:
   - Verify port 22 is open
   - Source: 0.0.0.0/0

4. **Check instance firewall** (after connecting):
   ```bash
   sudo iptables -L -n
   ```

### Forgot to Save SSH Key

**Issue**: Didn't save private key during instance creation

**Solution**:
1. Stop the instance
2. Detach boot volume
3. Create new instance
4. Attach old boot volume as secondary
5. Access files
6. Or: Create new instance and start over

---

## 💰 Cost Check

### Always Free Tier Limits

**Compute:**
- ✅ 4 Ampere A1 cores (ARM)
- ✅ 24GB RAM total
- ✅ 2 VMs with 1 OCPU + 8GB each (AMD)

**Storage:**
- ✅ 200GB total block volume
- ✅ 10GB object storage

**Network:**
- ✅ 10TB outbound transfer/month

**Your setup (1 VM with 4 OCPU, 24GB):**
- ✅ Within free tier limits!
- ✅ $0/month forever

### Check Your Usage

1. Click ☰ menu → **Billing & Cost Management** → **Cost Analysis**
2. View current usage
3. Set up budget alerts (optional)

---

## 📝 Instance Summary

After setup, save these details:

```
Instance Name: bg-remover-api
Public IP: _________________
Shape: VM.Standard.A1.Flex (4 OCPU, 24GB RAM)
OS: Ubuntu 22.04
SSH Key Location: _________________
Username: ubuntu

Connection Command:
ssh -i /path/to/key.key ubuntu@YOUR_IP

API URL (after deployment):
http://YOUR_IP
```

---

## 🆘 Need Help?

**Oracle Cloud Documentation:**
- Compute instances: https://docs.oracle.com/en-us/iaas/Content/Compute/home.htm
- Networking: https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/overview.htm

**Common Issues:**
- Can't create free tier: Try different region/time
- SSH not working: Check key permissions and security list
- Instance slow: Verify you selected correct shape

**Next Steps:**
- See [QUICK_START.md](QUICK_START.md) for deployment
- See [README.md](README.md) for full documentation

---

**🎉 Congratulations! Your Oracle Cloud instance is ready!**

**Next**: Follow [QUICK_START.md](QUICK_START.md) to deploy your background remover.
