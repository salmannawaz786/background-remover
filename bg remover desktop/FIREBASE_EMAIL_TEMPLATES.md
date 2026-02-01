# Customize Firebase Password Reset Email Template

## 🎨 Edit Email Template in Firebase Console

### Step 1: Access Email Templates

1. Go to **Firebase Console:** https://console.firebase.google.com/
2. Select your project: **are-you-genius-1f253**
3. Go to **Authentication** (left sidebar)
4. Click **Templates** tab (top menu)
5. Select **Password reset** template

---

### Step 2: Customize the Template

#### Basic Customization (Free Plan)

**From name:**
```
SalluLabs
```

**Reply-to email:**
```
support@sallulabs.com
```

**Subject:**
```
🔑 Reset Your SalluLabs Password
```

**Email body (Plain text):**
```
Hello,

You requested to reset your password for your SalluLabs account.

Click the link below to reset your password:
%LINK%

If you didn't request this, you can safely ignore this email.

Thanks,
The SalluLabs Team

---
SalluLabs - Professional Background Removal
https://sallulabs.com
```

---

#### Advanced Customization (HTML Template)

Click **Customize action URL** and add:
```
https://sallulabs.com/reset-password
```

Then create a custom HTML template:

**Subject:**
```
🔑 Reset Your SalluLabs Password
```

**HTML body:**
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" max-width="500" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #FACC15 0%, #F59E0B 100%); padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #1a1a1a; font-size: 28px; font-weight: 700;">🔐 Password Reset</h1>
                            <p style="margin: 8px 0 0 0; color: #333; font-size: 14px;">SalluLabs BG Remover</p>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <h2 style="margin: 0 0 10px 0; color: #1a1a1a; font-size: 22px;">Hello! 👋</h2>
                            <p style="margin: 0 0 25px 0; color: #666; font-size: 16px; line-height: 1.5;">
                                You requested to reset your password for your SalluLabs account.
                            </p>
                            
                            <!-- Reset Button -->
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="%LINK%" style="display: inline-block; background: linear-gradient(135deg, #FACC15 0%, #F59E0B 100%); color: #1a1a1a; text-decoration: none; padding: 15px 40px; border-radius: 8px; font-weight: 700; font-size: 16px;">
                                    Reset Password
                                </a>
                            </div>
                            
                            <p style="margin: 25px 0 0 0; color: #999; font-size: 14px; text-align: center;">
                                ⏱️ This link expires in <strong>1 hour</strong>
                            </p>
                            
                            <p style="margin: 20px 0 0 0; color: #999; font-size: 13px; line-height: 1.5;">
                                Or copy and paste this link into your browser:<br>
                                <span style="color: #666; word-break: break-all;">%LINK%</span>
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9f9f9; padding: 25px 30px; border-top: 1px solid #eee;">
                            <p style="margin: 0 0 10px 0; color: #999; font-size: 13px; text-align: center;">
                                Didn't request this? You can safely ignore this email.
                            </p>
                            <p style="margin: 0; color: #999; font-size: 13px; text-align: center;">
                                © 2026 SalluLabs. All rights reserved.
                            </p>
                            <p style="margin: 10px 0 0 0; text-align: center;">
                                <a href="https://sallulabs.com" style="color: #FACC15; text-decoration: none; font-size: 13px;">sallulabs.com</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
```

**Note:** Firebase automatically replaces `%LINK%` with the actual reset link.

---

## 🌐 Create Custom Password Reset Page

The link currently goes to Firebase's default page. Let's create a custom page on sallulabs.com.

### Option 1: Simple Redirect (Quick Fix)

Update `auth-renderer.js` to remove the custom URL:

```javascript
// Remove actionCodeSettings to use Firebase's default handler
await sendPasswordResetEmail(auth, email);
```

This will use Firebase's built-in password reset page (works perfectly).

---

### Option 2: Custom Domain Page (Advanced)

If you want users to reset password on `sallulabs.com`:

#### Step 1: Create Reset Password Page

Create a new file: `d:\background-remover-master\templates\reset-password.html`

This page will:
1. Extract `oobCode` from URL
2. Show password reset form
3. Call Firebase API to reset password

#### Step 2: Update Firebase Template

In Firebase Console → Authentication → Templates:
- Click **Customize action URL**
- Enter: `https://sallulabs.com/reset-password`

#### Step 3: Deploy to sallulabs.com

Upload the reset-password page to your website.

---

## 📧 Change Sender Email (Requires Paid Plan)

**Current sender:** `noreply@are-you-genius-1f253.firebaseapp.com`

**To use:** `noreply@sallulabs.com`

### Requirements:
1. Upgrade to **Firebase Blaze Plan** (pay-as-you-go)
2. Verify domain ownership
3. Configure custom SMTP settings

### Steps:
1. Firebase Console → Project Settings → Integrations
2. Enable **Custom SMTP**
3. Add your email server details
4. Verify domain via DNS records

**Alternative (Free):** Use Brevo for password reset emails too (requires custom implementation)

---

## ✅ What You Can Do Now (Free Plan)

1. ✅ Change "From name" to "SalluLabs"
2. ✅ Customize email subject
3. ✅ Edit email body (text and HTML)
4. ✅ Add your logo/branding
5. ✅ Change button colors
6. ✅ Add footer with your domain
7. ❌ Cannot change sender email (requires paid plan)

---

## 🎯 Recommended Setup (Free Plan)

1. **From name:** `SalluLabs`
2. **Subject:** `🔑 Reset Your SalluLabs Password`
3. **Use HTML template** with your brand colors (yellow/gold)
4. **Keep Firebase's default reset page** (it works great!)
5. **Add your logo** to email header

This gives you 90% of the branding without needing a paid plan!

---

## 🔗 About the Reset Link

The link you showed:
```
https://are-you-genius-1f253.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=...&continueUrl=https://sallulabs.com/auth/reset-complete
```

**What happens:**
1. User clicks link → Goes to Firebase's reset page
2. User enters new password → Firebase validates
3. After success → Redirects to `continueUrl` (your sallulabs.com page)

**To customize:**
- The reset page itself requires custom hosting
- Or use Firebase's default (it's clean and works well)
- The `continueUrl` is where users go AFTER resetting (you can customize this)

---

## 📝 Quick Action Items

1. **Now:** Customize email template in Firebase Console
2. **Now:** Change from name to "SalluLabs"
3. **Now:** Use the HTML template provided above
4. **Later:** Consider custom reset page if you want full control
5. **Later:** Upgrade to Blaze plan if you need custom sender email
