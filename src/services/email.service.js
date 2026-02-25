import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();



//cofigurar el transportador

const transporter = nodemailer.createTransport({
    host : 'smtp.gmail.com',
    port : 465,
    secure : true,
    auth : {
        user : process.env.GMAIL_USER,
        pass : process.env.GMAIL_PASSWORD
    }
});


//funcion de envio
export const sendEmail = async (to, subject, html) => {

    try{
        console.log('Sending email to:', to);
        const mailOptions = {
            from : process.env.GMAIL_USER,
            to: to,
            subject: subject,
            text: html,
        };
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ');

        return {
            message : 'Email sent successfully',
            
            success: true
        }


    } catch (error) {
        console.error('Error sending email:' + error);
        return {
            message : 'Error sending email',
            error: error,
            success: false
        }
    }
}