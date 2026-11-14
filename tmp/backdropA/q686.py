
import numpy as np
from PIL import Image
im=Image.open(r"C:\Users\12252\Desktop\Files\Code\PigHub\dsh-pighub\assets\img\pighub-686.png").convert("RGBA")
a=np.asarray(im); R=a[:,:,0].astype(int);G=a[:,:,1].astype(int);B=a[:,:,2].astype(int);A=a[:,:,3].astype(int)
navy=(A>60)&(np.abs(R-86)<34)&(np.abs(G-74)<34)&(np.abs(B-116)<50)&(B>G+8)&(B>R+4)&(R>50)
ys,xs=np.nonzero(navy); print("bbox",xs.min(),ys.min(),xs.max(),ys.max(),"size",im.size,"n",len(xs))
